"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient, createServiceClient, mfaIsRecent, requireSession } from "@/lib/supabase/server";
import { pluggyFor } from "@/lib/pluggy";
import { normalizeDesc } from "@/lib/format";
import { listBackups, makeBackup } from "@/lib/backup";
import { canManageConnection, revokeConnectionsOf } from "@/lib/people";

const uuid = z.string().uuid();
const COLORS = ["", "c1", "c2", "c3", "c4", "c5", "c6"] as const;
const done = () => revalidatePath("/", "layout");
type Result = { ok?: boolean; error?: string; reauth?: boolean; message?: string; link?: string };

// ------------------------------------------------------------ categorias
const CatIn = z.object({
  name: z.string().trim().min(2).max(40),
  kind: z.enum(["expense", "income"]),
  parent_id: uuid.or(z.literal("")).optional(),
  color: z.enum(COLORS).optional(),
});

export async function createCategory(_: unknown, form: FormData): Promise<Result> {
  const s = await requireSession();
  const p = CatIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Dê um nome de 2 a 40 letras." };
  const db = await createClient();
  let kind = p.data.kind, color: string | null = p.data.color || null, icon: string | null = null;
  if (p.data.parent_id) {
    const { data: parent } = await db.from("categories").select("id, kind, parent_id, color, icon").eq("id", p.data.parent_id).single();
    if (!parent || parent.parent_id) return { error: "Subcategoria só pode ficar dentro de uma categoria principal." };
    if (parent.kind === "transfer") return { error: "Transferências não têm subcategorias." };
    kind = parent.kind; color = null; icon = null; // herda da mãe
  } else icon = "dots";
  // nome repetido no mesmo nível não é permitido
  let dupQ = db.from("categories").select("id, name").eq("household_id", s.householdId);
  dupQ = p.data.parent_id ? dupQ.eq("parent_id", p.data.parent_id) : dupQ.is("parent_id", null);
  const { data: siblings } = await dupQ;
  if ((siblings ?? []).some((c) => normalizeDesc(c.name) === normalizeDesc(p.data.name))) return { error: "Já existe uma categoria com esse nome aqui." };
  const slug = `u-${normalizeDesc(p.data.name).replace(/\s+/g, "-").slice(0, 30)}-${Math.random().toString(36).slice(2, 6)}`;
  const { error } = await db.from("categories").insert({
    household_id: s.householdId, name: p.data.name, kind, parent_id: p.data.parent_id || null, color, icon, slug, sort: 50, is_system: false,
  });
  if (error) return { error: "Não foi possível criar a categoria." };
  done();
  return { ok: true };
}

export async function renameCategory(id: string, name: string, color: string): Promise<Result> {
  await requireSession(); uuid.parse(id);
  const n = z.string().trim().min(2).max(40).safeParse(name);
  if (!n.success) return { error: "Nome de 2 a 40 letras." };
  const c = z.enum(COLORS).safeParse(color);
  const db = await createClient();
  const { data: cat } = await db.from("categories").select("parent_id").eq("id", id).single();
  await db.from("categories").update({ name: n.data, ...(cat?.parent_id || !c.success ? {} : { color: c.data || null }) }).eq("id", id);
  done();
  return { ok: true };
}

/** Apaga uma categoria criada por você, movendo transações, divisões, destinatários e regras para outra. */
export async function deleteCategory(id: string, moveTo: string): Promise<Result> {
  const s = await requireSession();
  if (!mfaIsRecent(s)) return { reauth: true }; uuid.parse(id); uuid.parse(moveTo);
  if (id === moveTo) return { error: "Escolha outra categoria de destino." };
  const db = await createClient();
  const { data: cat } = await db.from("categories").select("is_system, kind").eq("id", id).single();
  if (!cat) return { error: "Categoria não encontrada." };
  if (cat.is_system) return { error: "As categorias padrão não podem ser apagadas; renomeie ou crie subcategorias." };
  const { count: kids } = await db.from("categories").select("id", { count: "exact", head: true }).eq("parent_id", id);
  if (kids) return { error: "Apague ou mova as subcategorias primeiro." };
  const { data: target } = await db.from("categories").select("kind").eq("id", moveTo).single();
  if (!target || target.kind !== cat.kind) return { error: "O destino precisa ser do mesmo tipo (gasto ou entrada)." };
  await db.from("transactions").update({ category_id: moveTo }).eq("category_id", id);
  await db.from("transaction_splits").update({ category_id: moveTo }).eq("category_id", id);
  await db.from("payees").update({ category_id: moveTo }).eq("category_id", id);
  await db.from("rules").update({ category_id: moveTo }).eq("category_id", id);
  await db.from("bills").update({ category_id: moveTo }).eq("category_id", id);
  await db.from("budgets").delete().eq("category_id", id);
  await db.from("categories").delete().eq("id", id);
  done();
  return { ok: true };
}

// ------------------------------------------------------------ regras e destinatários
const RuleIn = z.object({
  field: z.enum(["description", "counterpart_name"]),
  op: z.enum(["contains", "equals"]),
  value: z.string().trim().min(2).max(60),
  category_id: uuid,
  apply: z.string().optional(),
});

export async function createRule(_: unknown, form: FormData): Promise<Result> {
  const s = await requireSession();
  const p = RuleIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Preencha o texto (2 a 60 letras) e a categoria." };
  const db = await createClient();
  const { field, op, value, category_id } = p.data;
  const { error } = await db.from("rules").insert({
    household_id: s.householdId, name: `${field === "description" ? "Descrição" : "Destinatário"} ${op === "contains" ? "contém" : "é"} “${value}”`,
    conditions: [{ field, op, value }], category_id, source: "manual",
  });
  if (error) return { error: "Não foi possível salvar a regra." };
  let applied = 0;
  if (p.data.apply) applied = await applyRule(db, s.householdId, { field, op, value }, category_id);
  done();
  return { ok: true, message: applied ? `Regra salva e aplicada a ${applied} transações em revisão.` : "Regra salva. Vale para as próximas transações." };
}

async function applyRule(db: Awaited<ReturnType<typeof createClient>>, hid: string, c: { field: string; op: string; value: string }, categoryId: string) {
  const { data } = await db.from("transactions").select("id, description, counterpart_name").eq("household_id", hid).eq("status", "review").is("deleted_at", null).limit(2000);
  const v = normalizeDesc(c.value);
  const ids = (data ?? []).filter((t) => {
    const raw = normalizeDesc((c.field === "description" ? t.description : t.counterpart_name) ?? "");
    return c.op === "equals" ? raw === v : raw.includes(v);
  }).map((t) => t.id);
  if (ids.length) await db.from("transactions").update({ category_id: categoryId, category_source: "rule", confidence: 0.99, status: "ok" }).in("id", ids);
  return ids.length;
}

export async function setRuleActive(id: string, active: boolean) {
  await requireSession(); uuid.parse(id);
  const db = await createClient();
  await db.from("rules").update({ active, ...(active ? { source: "manual" } : {}) }).eq("id", id);
  done();
}

export async function deleteRule(id: string): Promise<Result> {
  const s = await requireSession();
  if (!mfaIsRecent(s)) return { reauth: true }; uuid.parse(id);
  const db = await createClient();
  await db.from("rules").delete().eq("id", id);
  done();
  return { ok: true };
}

export async function setPayeeCategory(id: string, categoryId: string) {
  await requireSession(); uuid.parse(id); uuid.parse(categoryId);
  const db = await createClient();
  await db.from("payees").update({ category_id: categoryId }).eq("id", id);
  done();
}

export async function deletePayee(id: string): Promise<Result> {
  const s = await requireSession();
  if (!mfaIsRecent(s)) return { reauth: true }; uuid.parse(id);
  const db = await createClient();
  await db.from("payees").delete().eq("id", id);
  done();
  return { ok: true };
}

// ------------------------------------------------------------ privacidade (LGPD)
/** Revoga a conexão na Pluggy (o banco deixa de enviar dados). O histórico já importado continua guardado. */
export async function disconnectBank(connectionId: string): Promise<Result> {
  const s = await requireSession(); uuid.parse(connectionId);
  if (!mfaIsRecent(s)) return { reauth: true };
  const db = await createClient();
  const { data: c } = await db.from("connections").select("id, provider_item_id, created_by").eq("id", connectionId).single();
  if (!c) return { error: "Conexão não encontrada." };
  if (!canManageConnection(c, s)) return { error: "Só quem conectou este banco (ou o dono da conta) pode desconectar." };
  try { await (await pluggyFor(s.householdId)).deleteItem(c.provider_item_id); } catch (e) {
    if (!String(e).includes("404")) return { error: "A Pluggy não confirmou a revogação. Tente de novo em instantes." };
  }
  await db.from("accounts").update({ connection_id: null }).eq("connection_id", c.id);
  await db.from("connections").delete().eq("id", c.id);
  done();
  return { ok: true };
}

/**
 * Exclui a conta e TODOS os dados: revoga as conexões na Pluggy, apaga os comprovantes,
 * o household (todas as tabelas em cascata) e o usuário. Exige 2FA recente e a frase de confirmação.
 */
export async function deleteAccount(confirmation: string): Promise<Result> {
  const s = await requireSession();
  if (!mfaIsRecent(s)) return { reauth: true };
  if (confirmation.trim().toUpperCase() !== "EXCLUIR MINHA CONTA") return { error: "Digite exatamente: EXCLUIR MINHA CONTA" };
  const admin = createServiceClient();
  if (s.role !== "owner") {
    // quem foi convidado só sai: os bancos que ele conectou são revogados e o histórico deles apagado;
    // o resto das finanças da casa continua com o dono
    await revokeConnectionsOf(admin, s.householdId, s.userId, false);
    await admin.from("household_members").delete().eq("household_id", s.householdId).eq("user_id", s.userId);
    await admin.from("household_invites").delete().eq("household_id", s.householdId).eq("email", s.email.toLowerCase());
    await admin.auth.admin.deleteUser(s.userId);
    const db = await createClient();
    await db.auth.signOut();
    return { ok: true };
  }
  const { data: members } = await admin.from("household_members").select("user_id").eq("household_id", s.householdId);
  const { data: conns } = await admin.from("connections").select("provider_item_id").eq("household_id", s.householdId);
  for (const c of conns ?? []) { try { await (await pluggyFor(s.householdId)).deleteItem(c.provider_item_id); } catch { /* já revogada */ } }
  // comprovantes no Storage (pasta do household)
  const { data: files } = await admin.storage.from("attachments").list(s.householdId, { limit: 1000 });
  for (const folder of files ?? []) {
    const { data: inner } = await admin.storage.from("attachments").list(`${s.householdId}/${folder.name}`, { limit: 1000 });
    const paths = (inner ?? []).map((f) => `${s.householdId}/${folder.name}/${f.name}`);
    if (paths.length) await admin.storage.from("attachments").remove(paths);
  }
  const backups = await listBackups(admin, s.householdId);
  if (backups.length) await admin.storage.from("backups").remove(backups.map((b) => b.path));
  await admin.from("audit_log").delete().eq("household_id", s.householdId);
  await admin.from("households").delete().eq("id", s.householdId);
  // apaga os logins que ficaram sem household: o dono e quem ele convidou (quem participa de outro continua)
  for (const m of members ?? []) {
    const { count } = await admin.from("household_members").select("household_id", { count: "exact", head: true }).eq("user_id", m.user_id);
    if (!count) await admin.auth.admin.deleteUser(m.user_id);
  }
  const db = await createClient();
  await db.auth.signOut();
  return { ok: true };
}

// ------------------------------------------------------------ modo casal (pessoas com acesso)
const MAX_PEOPLE = 5;

async function siteOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`;
}

/** Link de uso único (vale 1 hora). Abre em /auth/confirm, que entra e leva para definir a senha. */
async function makeLink(email: string, type: "invite" | "magiclink", inviteId?: string) {
  const admin = createServiceClient();
  // o id do convite vai no login criado: o banco só põe a pessoa na casa se o id e o e-mail baterem
  const { data, error } = await admin.auth.admin.generateLink(type === "invite" ? { type, email, options: { data: { fluxo_invite: inviteId } } } : { type, email });
  if (error || !data.properties?.hashed_token) return null;
  return `${await siteOrigin()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=${type}`;
}

async function findUserByEmail(email: string) {
  const admin = createServiceClient();
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const u = data?.users.find((x) => x.email?.toLowerCase() === email);
    if (u) return u;
    if (!data || data.users.length < 200) return null;
  }
  return null;
}

export async function inviteMember(_: unknown, form: FormData): Promise<Result> {
  const s = await requireSession();
  if (s.role !== "owner") return { error: "Só quem criou a conta pode convidar." };
  if (!mfaIsRecent(s)) return { reauth: true };
  const p = z.string().trim().toLowerCase().email().max(200).safeParse(form.get("email"));
  if (!p.success) return { error: "Informe um e-mail válido." };
  const email = p.data;
  if (email === s.email.toLowerCase()) return { error: "Esse é o seu próprio e-mail." };
  const admin = createServiceClient();
  const { count } = await admin.from("household_members").select("user_id", { count: "exact", head: true }).eq("household_id", s.householdId);
  if ((count ?? 0) >= MAX_PEOPLE) return { error: `Limite de ${MAX_PEOPLE} pessoas por conta.` };
  const existing = await findUserByEmail(email);
  if (existing) {
    const { data: mem } = await admin.from("household_members").select("household_id").eq("user_id", existing.id);
    if (!(mem ?? []).some((m) => m.household_id === s.householdId)) return { error: "Esse e-mail já tem conta no Apogeu e não pode ser convidado." };
    if (existing.factors?.some((x) => x.status === "verified")) return { error: "Essa pessoa já tem acesso." };
    const link = await makeLink(email, "magiclink");
    return link ? { ok: true, link } : { error: "Não foi possível gerar o link." };
  }
  // o convite fica registrado antes de criar o login: o banco usa ele para pôr a pessoa nesta casa
  await admin.from("household_invites").delete().eq("household_id", s.householdId).eq("email", email);
  const { data: inv, error } = await admin.from("household_invites").insert({ household_id: s.householdId, email, invited_by: s.userId }).select("id").single();
  if (error || !inv) return { error: "Não foi possível registrar o convite." };
  const link = await makeLink(email, "invite", inv.id);
  if (!link) {
    await admin.from("household_invites").delete().eq("household_id", s.householdId).eq("email", email);
    return { error: "Não foi possível gerar o link." };
  }
  done();
  return { ok: true, link };
}

/** Novo link para quem ainda não fez o primeiro acesso. */
export async function resendInvite(userId: string): Promise<Result> {
  const s = await requireSession(); uuid.parse(userId);
  if (s.role !== "owner") return { error: "Só quem criou a conta pode convidar." };
  if (!mfaIsRecent(s)) return { reauth: true };
  const admin = createServiceClient();
  const { data: m } = await admin.from("household_members").select("role").eq("household_id", s.householdId).eq("user_id", userId).maybeSingle();
  if (!m || m.role !== "member") return { error: "Pessoa não encontrada." };
  const { data: u } = await admin.auth.admin.getUserById(userId);
  if (!u.user?.email || u.user.factors?.some((x) => x.status === "verified")) return { error: "Essa pessoa já entrou; ela usa a própria senha." };
  const link = await makeLink(u.user.email, "magiclink");
  return link ? { ok: true, link } : { error: "Não foi possível gerar o link." };
}

/** Tira o acesso de alguém. Os dados da casa ficam; o login da pessoa é apagado. */
export async function removeMember(userId: string, keepHistory = false): Promise<Result> {
  const s = await requireSession(); uuid.parse(userId);
  if (s.role !== "owner") return { error: "Só quem criou a conta pode remover pessoas." };
  if (!mfaIsRecent(s)) return { reauth: true };
  if (userId === s.userId) return { error: "Para sair, exclua a sua conta." };
  const admin = createServiceClient();
  const { data: m } = await admin.from("household_members").select("role").eq("household_id", s.householdId).eq("user_id", userId).maybeSingle();
  if (!m || m.role !== "member") return { error: "Pessoa não encontrada." };
  const { data: u } = await admin.auth.admin.getUserById(userId);
  await revokeConnectionsOf(admin, s.householdId, userId, keepHistory === true);
  await admin.from("household_members").delete().eq("household_id", s.householdId).eq("user_id", userId);
  if (u.user?.email) await admin.from("household_invites").delete().eq("household_id", s.householdId).eq("email", u.user.email.toLowerCase());
  const { count } = await admin.from("household_members").select("household_id", { count: "exact", head: true }).eq("user_id", userId);
  if (!count) await admin.auth.admin.deleteUser(userId);
  done();
  return { ok: true };
}

// ------------------------------------------------------------ backups
export async function backupNow(): Promise<Result> {
  const s = await requireSession();
  const admin = createServiceClient();
  const last = (await listBackups(admin, s.householdId))[0];
  if (last?.created_at && Date.now() - Date.parse(last.created_at) < 10 * 60 * 1000) return { error: "Já existe um backup de menos de 10 minutos." };
  try {
    const r = await makeBackup(admin, s.householdId, "manual");
    done();
    return { ok: true, message: `Backup criado: ${r.rows} registros.` };
  } catch {
    return { error: "Não foi possível criar o backup agora." };
  }
}

/** Link de download que vale 60 segundos. Exige 2FA recente (o arquivo tem todos os dados). */
export async function backupLink(name: string): Promise<Result> {
  const s = await requireSession();
  if (!mfaIsRecent(s)) return { reauth: true };
  if (!/^[\w.-]{10,80}\.json\.gz$/.test(name)) return { error: "Arquivo inválido." };
  // link assinado pelo servidor (o cofre não tem leitura direta), só da pasta desta casa
  const { data, error } = await createServiceClient().storage.from("backups").createSignedUrl(`${s.householdId}/${name}`, 60, { download: `apogeu-backup-${name}` });
  if (error || !data) return { error: "Backup não encontrado." };
  // registra o download: o painel lembra de guardar uma cópia fora do Supabase uma vez por mês
  await createServiceClient().from("audit_log").insert({ household_id: s.householdId, actor: s.userId, table_name: "backup_download", action: "export", diff: { name } });
  return { ok: true, link: data.signedUrl };
}

/** Convidado perdeu o celular: apaga o autenticador dele; no próximo login ele cadastra outro. */
export async function resetMemberMfa(userId: string): Promise<Result> {
  const s = await requireSession(); uuid.parse(userId);
  if (s.role !== "owner") return { error: "Só o dono da conta pode redefinir o 2FA de alguém." };
  if (!mfaIsRecent(s)) return { reauth: true };
  if (userId === s.userId) return { error: "Para o seu próprio 2FA, use o script scripts/reset-mfa.mjs no computador." };
  const admin = createServiceClient();
  const { data: m } = await admin.from("household_members").select("role").eq("household_id", s.householdId).eq("user_id", userId).maybeSingle();
  if (!m || m.role !== "member") return { error: "Pessoa não encontrada." };
  const { data: f } = await admin.auth.admin.mfa.listFactors({ userId });
  for (const factor of f?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
  await createServiceClient().from("audit_log").insert({ household_id: s.householdId, actor: s.userId, table_name: "mfa_reset", row_id: userId, action: "update" });
  done();
  return { ok: true };
}
