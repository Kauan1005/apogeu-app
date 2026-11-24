"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, createServiceClient, mfaIsRecent, requireSession } from "@/lib/supabase/server";
import { storeEmbedding } from "@/lib/ingest";
import { normalizeDesc } from "@/lib/format";
import { suggestBudgets } from "@/lib/phase2";
import { suggestHabits } from "@/lib/habits";

const uuid = z.string().uuid();
const done = () => { revalidatePath("/", "layout"); };

/**
 * Corrige a categoria. Com "lembrar", cria/atualiza o destinatário conhecido (regra automática)
 * e aplica às transações em revisão do mesmo destinatário. Depois de 3 correções iguais por
 * palavra-chave, sugere uma regra (o usuário aceita na tela Revisar).
 */
export async function setCategory(txId: string, categoryId: string, remember: boolean) {
  const s = await requireSession();
  uuid.parse(txId); uuid.parse(categoryId);
  const db = await createClient();
  const { data: tx } = await db.from("transactions").select("id, payee_key, description, counterpart_name, category_id, category_source, confidence, status, is_internal_transfer, refund_pair_id").eq("id", txId).single();
  if (!tx) throw new Error("Transação não encontrada");
  const undo: UndoCategory = { txId, prev: { category_id: tx.category_id, category_source: tx.category_source, confidence: tx.confidence == null ? null : Number(tx.confidence), status: tx.status, is_internal_transfer: !!tx.is_internal_transfer }, others: [], payee: null };

  // escolher "Transferência interna" (ou voltar atrás) acerta também a marca de movimentação interna; par de devolução não é desfeito por aqui
  const { data: catRow } = await db.from("categories").select("kind").eq("id", categoryId).maybeSingle();
  const internal = catRow?.kind === "transfer" ? true : tx.refund_pair_id ? !!tx.is_internal_transfer : false;
  await db.from("transactions").update({ category_id: categoryId, category_source: "user", confidence: 1, status: "ok", is_internal_transfer: internal }).eq("id", txId);
  let applied = 0;
  if (remember && tx.payee_key) {
    const { data: prevPayee } = await db.from("payees").select("category_id").eq("household_id", s.householdId).eq("key", tx.payee_key).maybeSingle();
    undo.payee = { key: tx.payee_key, prevCategory: prevPayee?.category_id ?? null };
    await db.from("payees").upsert(
      { household_id: s.householdId, key: tx.payee_key, category_id: categoryId, display_name: tx.counterpart_name ?? tx.description },
      { onConflict: "household_id,key" },
    );
    const { data: others } = await db
      .from("transactions")
      .update({ category_id: categoryId, category_source: "payee", confidence: 0.97, status: "ok" })
      .eq("household_id", s.householdId).eq("payee_key", tx.payee_key).eq("status", "review").neq("id", txId)
      .select("id");
    applied = others?.length ?? 0;
    undo.others = (others ?? []).map((o) => o.id);
  }
  await suggestKeywordRule(db, s.householdId, categoryId, tx.description);
  await storeEmbedding(db, s.householdId, txId, `${tx.description} ${tx.counterpart_name ?? ""}`);
  done();
  return { applied, undo };
}

export type UndoCategory = {
  txId: string;
  prev: { category_id: string | null; category_source: string | null; confidence: number | null; status: string; is_internal_transfer?: boolean };
  others: string[];
  payee: { key: string; prevCategory: string | null } | null;
};
const UndoCat = z.object({
  txId: uuid,
  prev: z.object({ category_id: uuid.nullable(), category_source: z.string().max(20).nullable(), confidence: z.number().min(0).max(1).nullable(), status: z.enum(["ok", "review", "canceled"]), is_internal_transfer: z.boolean().optional() }),
  others: z.array(uuid).max(500),
  payee: z.object({ key: z.string().max(200), prevCategory: uuid.nullable() }).nullable(),
});

/** Desfaz a última troca de categoria (e o que ela aplicou ao mesmo destinatário). */
export async function undoCategory(input: UndoCategory) {
  const s = await requireSession();
  const u = UndoCat.parse(input);
  const db = await createClient();
  await db.from("transactions").update(u.prev).eq("id", u.txId).eq("household_id", s.householdId);
  if (u.others.length) await db.from("transactions").update({ status: "review" }).in("id", u.others).eq("household_id", s.householdId);
  if (u.payee) {
    if (u.payee.prevCategory) await db.from("payees").update({ category_id: u.payee.prevCategory }).eq("household_id", s.householdId).eq("key", u.payee.key);
    else await db.from("payees").delete().eq("household_id", s.householdId).eq("key", u.payee.key);
  }
  done();
  return { ok: true };
}

/** Revisar: aceita de uma vez todas as sugestões da fila (só as que têm categoria sugerida). */
export async function acceptAllSuggestions() {
  const s = await requireSession();
  const db = await createClient();
  const { data } = await db.from("transactions").update({ status: "ok" })
    .eq("household_id", s.householdId).eq("status", "review").is("deleted_at", null).not("category_id", "is", null)
    .select("id");
  done();
  return { ids: (data ?? []).map((r) => r.id as string) };
}

/** Desfaz o "aceitar todas": as transações voltam para a fila. */
export async function reopenReview(ids: string[]) {
  const s = await requireSession();
  const list = z.array(uuid).max(1000).parse(ids);
  const db = await createClient();
  if (list.length) await db.from("transactions").update({ status: "review" }).in("id", list).eq("household_id", s.householdId);
  done();
}


async function suggestKeywordRule(db: Awaited<ReturnType<typeof createClient>>, hid: string, categoryId: string, description: string) {
  const word = normalizeDesc(description).split(" ").find((w) => w.length >= 4 && !["pix", "enviado", "recebido", "pagamento", "compra"].includes(w));
  if (!word) return;
  const { count } = await db.from("transactions").select("id", { count: "exact", head: true })
    .eq("household_id", hid).eq("category_id", categoryId).eq("category_source", "user").ilike("description", `%${word}%`);
  if ((count ?? 0) < 3) return;
  const { data: rules } = await db.from("rules").select("id, conditions").eq("household_id", hid);
  const exists = (rules ?? []).some((r) => JSON.stringify(r.conditions).toLowerCase().includes(`"${word}"`));
  if (exists) return;
  await db.from("rules").insert({
    household_id: hid, name: `“${word}” → categoria`, source: "suggested", category_id: categoryId,
    conditions: [{ field: "description", op: "contains", value: word }],
  });
}

export async function acceptRule(ruleId: string, accept: boolean) {
  await requireSession(); uuid.parse(ruleId);
  const db = await createClient();
  if (accept) await db.from("rules").update({ source: "manual", active: true }).eq("id", ruleId);
  else await db.from("rules").delete().eq("id", ruleId);
  done();
}

export async function setNotes(txId: string, notes: string) {
  await requireSession(); uuid.parse(txId);
  const db = await createClient();
  await db.from("transactions").update({ notes: notes.slice(0, 2000) || null }).eq("id", txId);
  done();
}

export async function setTags(txId: string, names: string[]) {
  const s = await requireSession(); uuid.parse(txId);
  const db = await createClient();
  const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n && n.length <= 30))].slice(0, 10);
  await db.from("transaction_tags").delete().eq("transaction_id", txId);
  if (clean.length) {
    const { data: tags } = await db.from("tags").upsert(clean.map((name) => ({ household_id: s.householdId, name })), { onConflict: "household_id,name" }).select("id");
    await db.from("transaction_tags").insert((tags ?? []).map((t) => ({ transaction_id: txId, tag_id: t.id, household_id: s.householdId })));
  }
  done();
}

const Split = z.array(z.object({ category_id: uuid, amount_cents: z.number().int(), note: z.string().max(120).optional() })).max(10);

/** Divide uma transação; a soma das partes precisa bater com o valor. Lista vazia desfaz a divisão. */
export async function splitTransaction(txId: string, parts: z.infer<typeof Split>): Promise<{ ok?: boolean; error?: string }> {
  const s = await requireSession(); uuid.parse(txId);
  const parsed = Split.safeParse(parts);
  if (!parsed.success) return { error: "Confira as categorias e os valores das partes." };
  const list = parsed.data;
  const db = await createClient();
  const { data: tx } = await db.from("transactions").select("amount_cents").eq("id", txId).single();
  if (!tx) return { error: "Transação não encontrada." };
  if (list.length && list.reduce((a, p) => a + p.amount_cents, 0) !== tx.amount_cents) return { error: "A soma das partes precisa ser igual ao valor da transação." };
  await db.from("transaction_splits").delete().eq("transaction_id", txId);
  if (list.length) await db.from("transaction_splits").insert(list.map((p) => ({ ...p, transaction_id: txId, household_id: s.householdId })));
  done();
  return { ok: true };
}

/** Lixeira: some das telas e é apagada de vez depois de 30 dias. */
export async function trashTransaction(txId: string, restore = false) {
  const s = await requireSession(); uuid.parse(txId);
  if (!restore && !mfaIsRecent(s)) return { reauth: true };
  const db = await createClient();
  await db.from("transactions").update({ deleted_at: restore ? null : new Date().toISOString() }).eq("id", txId);
  done();
}

export async function addAttachment(txId: string, path: string, filename: string) {
  const s = await requireSession(); uuid.parse(txId);
  if (!path.startsWith(`${s.householdId}/`)) throw new Error("Caminho inválido");
  const db = await createClient();
  await db.from("attachments").insert({ transaction_id: txId, household_id: s.householdId, storage_path: path, filename: filename.slice(0, 120) });
  done();
}

// ------------------------------------------------------------ contas a pagar
const Bill = z.object({
  name: z.string().trim().min(2).max(60),
  amount: z.coerce.number().positive().max(1_000_000),
  due_day: z.coerce.number().int().min(1).max(31),
  recurrence: z.enum(["monthly", "once", "installments"]),
  installments_total: z.coerce.number().int().min(2).max(120).optional().or(z.literal("").transform(() => undefined)),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category_id: z.string().uuid().or(z.literal("")).optional(),
  match_keyword: z.string().trim().max(40).optional(),
  payment_code: z.string().trim().max(600).optional(),
});

export async function createBill(_: unknown, form: FormData) {
  const s = await requireSession();
  const parsed = Bill.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Confira nome, valor e dia de vencimento." };
  const b = parsed.data;
  if (b.recurrence === "installments" && !b.installments_total) return { error: "Informe em quantas parcelas (2 a 120)." };
  const db = await createClient();
  const { error } = await db.from("bills").insert({
    household_id: s.householdId, name: b.name, amount_cents: Math.round(b.amount * 100), due_day: b.due_day,
    recurrence: b.recurrence, starts_on: b.starts_on, category_id: b.category_id || null, match_keyword: b.match_keyword || null,
    payment_code: b.payment_code || null,
    installments_total: b.recurrence === "installments" ? b.installments_total : null,
  });
  if (error) return { error: "Não foi possível salvar a conta." };
  done();
  return { ok: true };
}

/** Alterna entre pago e em aberto. Em aberto volta a ser pendente ou atrasada pelo vencimento. */
export async function toggleBillPaid(occurrenceId: string, paid: boolean) {
  await requireSession(); uuid.parse(occurrenceId);
  const db = await createClient();
  await db.from("bill_occurrences")
    .update(paid ? { paid_at: new Date().toISOString(), paid_source: "manual" } : { paid_at: null, paid_source: null, matched_transaction_id: null })
    .eq("id", occurrenceId);
  done();
}

export async function deleteBill(billId: string) {
  const s = await requireSession();
  if (!mfaIsRecent(s)) return { reauth: true }; uuid.parse(billId);
  const db = await createClient();
  await db.from("bills").delete().eq("id", billId);
  done();
}

// ------------------------------------------------------------ orçamentos
const BudgetIn = z.object({ category_id: uuid, limit: z.coerce.number().positive().max(1_000_000), alert_pct: z.coerce.number().int().min(50).max(100).default(80) });

export async function saveBudget(_: unknown, form: FormData) {
  const s = await requireSession();
  const p = BudgetIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Escolha a categoria e um limite maior que zero." };
  const db = await createClient();
  const { error } = await db.from("budgets").upsert(
    { household_id: s.householdId, category_id: p.data.category_id, limit_cents: Math.round(p.data.limit * 100), alert_pct: p.data.alert_pct },
    { onConflict: "household_id,category_id" },
  );
  if (error) return { error: "Não foi possível salvar o orçamento." };
  done();
  return { ok: true };
}

export async function deleteBudget(id: string) {
  const s = await requireSession();
  if (!mfaIsRecent(s)) return { reauth: true }; uuid.parse(id);
  const db = await createClient();
  await db.from("budgets").delete().eq("id", id);
  done();
}

// ------------------------------------------------------------ metas
const GoalIn = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(["saving", "emergency"]),
  target: z.coerce.number().positive().max(100_000_000).optional().or(z.literal("").transform(() => undefined)),
  target_months: z.coerce.number().int().min(1).max(24).optional().or(z.literal("").transform(() => undefined)),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
});

export async function createGoal(_: unknown, form: FormData) {
  const s = await requireSession();
  const p = GoalIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Confira o nome e o valor da meta." };
  const g = p.data;
  if (g.kind === "saving" && !g.target) return { error: "Informe o valor da meta." };
  if (g.kind === "emergency" && !g.target_months && !g.target) return { error: "Informe quantos meses de gastos a reserva deve cobrir." };
  const db = await createClient();
  const { error } = await db.from("goals").insert({
    household_id: s.householdId, name: g.name, kind: g.kind,
    target_cents: g.target ? Math.round(g.target * 100) : null, target_months: g.kind === "emergency" ? g.target_months ?? 6 : null, deadline: g.deadline ?? null,
  });
  if (error) return { error: "Não foi possível criar a meta." };
  done();
  return { ok: true };
}

export async function addContribution(goalId: string, amount: number, note?: string) {
  const s = await requireSession(); uuid.parse(goalId);
  const cents = Math.round(z.number().finite().parse(amount) * 100);
  if (!cents) throw new Error("Valor inválido");
  const db = await createClient();
  await db.from("goal_contributions").insert({ goal_id: goalId, household_id: s.householdId, amount_cents: cents, note: note?.slice(0, 120) || null });
  done();
}

/**
 * Aporte sugerido depois do salário. O valor é recalculado aqui a partir da entrada (o navegador só diz a porcentagem).
 * Meta com aportes manuais recebe o aporte; meta ligada a cofrinho só registra que a pessoa guardou (o progresso vem do saldo).
 */
export async function resolveSavings(txId: string, action: "saved" | "dismissed", pct = 10, goalId?: string | null) {
  const s = await requireSession(); uuid.parse(txId);
  const p = z.number().int().min(1).max(50).parse(pct);
  const db = await createClient();
  const { data: tx } = await db.from("transactions").select("id, amount_cents").eq("id", txId).eq("household_id", s.householdId).gt("amount_cents", 0).maybeSingle();
  if (!tx) return { error: "Entrada não encontrada." };
  if (action === "dismissed") {
    await db.from("savings_nudges").upsert({ household_id: s.householdId, transaction_id: txId, status: "dismissed" }, { onConflict: "household_id,transaction_id" });
    done();
    return { ok: true };
  }
  const cents = Math.round((Number(tx.amount_cents) * p) / 100);
  let goal: string | null = null;
  if (goalId) {
    uuid.parse(goalId);
    const { data: g } = await db.from("goals").select("id, pot_refs").eq("id", goalId).eq("household_id", s.householdId).maybeSingle();
    if (!g) return { error: "Meta não encontrada." };
    goal = g.id as string;
    const linked = ((g.pot_refs as string[] | null) ?? []).length > 0;
    if (!linked) await db.from("goal_contributions").insert({ goal_id: goal, household_id: s.householdId, amount_cents: cents, note: "Aporte do salário" });
  }
  await db.from("savings_nudges").upsert({ household_id: s.householdId, transaction_id: txId, status: "saved", pct: p, amount_cents: cents, goal_id: goal }, { onConflict: "household_id,transaction_id" });
  done();
  return { ok: true };
}

// ------------------------------------------------------------ filtros salvos das Transações
const SavedFilter = z.object({
  q: z.string().max(80).default(""),
  account: z.string().uuid().or(z.literal("")).default(""),
  cat: z.string().uuid().or(z.literal("")).default(""),
  person: z.string().uuid().or(z.literal("")).default(""),
  review: z.boolean().default(false),
  min: z.number().min(0).max(1_000_000_000).default(0), // valor mínimo, em reais
  group: z.enum(["dia", "mes", "categoria", "conta"]).default("dia"),
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]).default(1),
});

export async function saveFilter(name: string, filter: unknown) {
  const s = await requireSession();
  const n = z.string().trim().min(1).max(40).safeParse(name);
  const f = SavedFilter.safeParse(filter);
  if (!n.success || !f.success) return { error: "Dê um nome curto ao filtro." };
  const db = await createClient();
  const { count } = await db.from("saved_filters").select("id", { count: "exact", head: true }).eq("household_id", s.householdId).eq("user_id", s.userId);
  if ((count ?? 0) >= 20) return { error: "Você já tem 20 filtros salvos. Exclua algum." };
  const { data, error } = await db.from("saved_filters").insert({ household_id: s.householdId, user_id: s.userId, name: n.data, filter: f.data }).select("id").single();
  if (error || !data) return { error: "Não foi possível salvar o filtro." };
  done();
  return { ok: true as const, id: data.id as string };
}

export async function deleteFilter(id: string) {
  const s = await requireSession(); uuid.parse(id);
  const db = await createClient();
  await db.from("saved_filters").delete().eq("id", id).eq("household_id", s.householdId).eq("user_id", s.userId);
  done();
}

export async function deleteGoal(id: string) {
  const s = await requireSession();
  if (!mfaIsRecent(s)) return { reauth: true }; uuid.parse(id);
  const db = await createClient();
  await db.from("goals").delete().eq("id", id);
  done();
}

// ------------------------------------------------------------ cobranças recorrentes
export async function setRecurringFlag(key: string, status: "confirmed" | "ignored" | null) {
  const s = await requireSession();
  z.string().min(2).max(200).parse(key);
  const db = await createClient();
  if (status) await db.from("recurring_flags").upsert({ household_id: s.householdId, key, status, updated_at: new Date().toISOString() }, { onConflict: "household_id,key" });
  else await db.from("recurring_flags").delete().eq("household_id", s.householdId).eq("key", key);
  done();
}

/** Código de pagamento do mês (ex.: linha digitável do boleto). Vazio volta a usar o código fixo da conta. */
export async function setOccurrenceCode(occurrenceId: string, code: string) {
  await requireSession(); uuid.parse(occurrenceId);
  const clean = z.string().trim().max(600).parse(code);
  const db = await createClient();
  await db.from("bill_occurrences").update({ payment_code: clean || null }).eq("id", occurrenceId);
  done();
}

// ------------------------------------------------------------ patrimônio (bens e dívidas manuais)
const ASSET_CATS = ["investimento", "imovel", "veiculo", "outro_bem"] as const;
const HoldingIn = z.object({
  id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  category: z.enum([...ASSET_CATS, "financiamento", "emprestimo", "outra_divida"]),
  name: z.string().trim().min(2, "Dê um nome.").max(80),
  value: z.coerce.number().min(0, "Valor inválido.").max(1_000_000_000),
  note: z.string().trim().max(200).optional(),
  acquisition: z.union([z.literal("").transform(() => null), z.coerce.number().min(0, "Valor pago inválido.").max(1_000_000_000)]).optional(),
  acquired_on: z.union([z.literal("").transform(() => null), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")]).optional(),
});

export async function saveHolding(_prev: unknown, form: FormData) {
  const s = await requireSession();
  const p = HoldingIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Dados inválidos." };
  const { id, category, name, value, note, acquisition, acquired_on } = p.data;
  const isAsset = (ASSET_CATS as readonly string[]).includes(category);
  if (acquired_on && acquired_on > new Date().toISOString().slice(0, 10)) return { error: "A data da compra não pode ser no futuro." };
  const row = {
    acquisition_cents: isAsset && acquisition != null ? Math.round(acquisition * 100) : null,
    acquired_on: isAsset ? acquired_on ?? null : null,
    household_id: s.householdId, category, name, value_cents: Math.round(value * 100),
    side: (ASSET_CATS as readonly string[]).includes(category) ? "asset" : "liability",
    details: note ? { note } : {}, updated_at: new Date().toISOString(),
  };
  const db = await createClient();
  const { error } = id
    ? await db.from("holdings").update(row).eq("id", id).eq("source", "manual")
    : await db.from("holdings").insert({ ...row, source: "manual" });
  if (error) return { error: "Não foi possível salvar." };
  done();
  return { ok: true };
}

export async function deleteHolding(id: string) {
  const s = await requireSession();
  if (!mfaIsRecent(s)) return { reauth: true }; uuid.parse(id);
  const db = await createClient();
  await db.from("holdings").delete().eq("id", id).eq("source", "manual");
  done();
}

// ------------------------------------------------------------ orçamentos sugeridos (um toque)
export async function createSuggestedBudgets() {
  const s = await requireSession();
  const db = await createClient();
  const sugg = await suggestBudgets(db, s.householdId); // recalculado no servidor (não confia no navegador)
  if (!sugg.length) return { error: "Ainda não há gastos suficientes para sugerir." };
  const { error } = await db.from("budgets").upsert(
    sugg.map((g) => ({ household_id: s.householdId, category_id: g.category_id, limit_cents: g.limit_cents, alert_pct: 80 })),
    { onConflict: "household_id,category_id" },
  );
  if (error) return { error: "Não foi possível criar os orçamentos." };
  done();
  return { ok: true, count: sugg.length };
}

// ------------------------------------------------------------------ avisos no celular
const PushSub = z.object({ endpoint: z.string().url().startsWith("https://").max(1000), p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) });

export async function savePushSubscription(input: z.infer<typeof PushSub>) {
  const s = await requireSession();
  const p = PushSub.safeParse(input);
  if (!p.success) return { error: "Inscrição inválida." };
  // o mesmo aparelho pode ter sido usado por outra conta: o endereço é único, então troca o dono
  await createServiceClient().from("push_subscriptions").delete().eq("endpoint", p.data.endpoint);
  const db = await createClient();
  const { error } = await db.from("push_subscriptions").insert({ household_id: s.householdId, ...p.data });
  if (error) return { error: "Não foi possível salvar." };
  return { ok: true };
}

export async function removePushSubscription(endpoint: string) {
  await requireSession();
  const e = z.string().max(1000).parse(endpoint);
  const db = await createClient();
  await db.from("push_subscriptions").delete().eq("endpoint", e);
  return { ok: true };
}

// ------------------------------------------------------------------ busca rápida (Ctrl+F)
export type SearchHit = { kind: "tx" | "cat" | "acc"; id: string; title: string; sub: string; href: string; cents?: number };

export async function quickSearch(term: string): Promise<SearchHit[]> {
  const s = await requireSession();
  const q = z.string().trim().min(2).max(60).safeParse(term);
  if (!q.success) return [];
  const db = await createClient();
  // tira os caracteres que têm significado no filtro do PostgREST
  const like = `%${q.data.replace(/[%_\\,()*]/g, " ").trim()}%`;
  const num = Number(q.data.replace(/R\$|\s|\./g, "").replace(",", "."));
  const cents = /^\s*(R\$)?\s*[\d.,]+\s*$/.test(q.data) && Number.isFinite(num) ? Math.round(num * 100) : null;
  let tq = db.from("transactions").select("id, occurred_at, description, amount_cents")
    .eq("household_id", s.householdId).is("deleted_at", null).order("occurred_at", { ascending: false }).limit(8);
  tq = cents !== null
    ? tq.or(`amount_cents.eq.${cents},amount_cents.eq.${-cents}`)
    : tq.or(`description.ilike.${like},counterpart_name.ilike.${like},notes.ilike.${like}`);
  const [{ data: txs }, { data: cats }, { data: accs }] = await Promise.all([
    tq,
    cents !== null ? Promise.resolve({ data: [] as { id: string; name: string }[] }) : db.from("categories").select("id, name").eq("household_id", s.householdId).ilike("name", like).limit(4),
    cents !== null ? Promise.resolve({ data: [] as { id: string; name: string; institution: string | null }[] }) : db.from("accounts").select("id, name, institution").eq("household_id", s.householdId).or(`name.ilike.${like},institution.ilike.${like}`).limit(3),
  ]);
  const ymOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" });
  return [
    ...(cats ?? []).map((c): SearchHit => ({ kind: "cat", id: c.id, title: c.name, sub: "Categoria", href: `/transacoes?periodo=3&categoria=${c.id}` })),
    ...(accs ?? []).map((a): SearchHit => ({ kind: "acc", id: a.id, title: a.name, sub: a.institution ?? "Conta", href: `/transacoes?periodo=3&conta=${a.id}` })),
    ...(txs ?? []).map((t): SearchHit => ({ kind: "tx", id: t.id, title: t.description, sub: day(t.occurred_at), cents: Number(t.amount_cents), href: `/transacoes?mes=${ymOf(t.occurred_at)}&abrir=${t.id}` })),
  ];
}

// ------------------------------------------------------------ cofrinhos: ocultar o que não é cofrinho
export async function setPotHidden(kind: "account" | "holding" | "pot", id: string, hidden: boolean) {
  const s = await requireSession();
  z.enum(["account", "holding", "pot"]).parse(kind); uuid.parse(id);
  const db = await createClient();
  if (kind === "pot") await db.from("account_pots").update({ hidden: !!hidden }).eq("id", id).eq("household_id", s.householdId);
  else await db.from(kind === "account" ? "accounts" : "holdings").update({ pot_hidden: !!hidden }).eq("id", id).eq("household_id", s.householdId);
  done();
  return { ok: true };
}

// ------------------------------------------------------------ metas ligadas a cofrinhos
const PotRef = z.string().regex(/^(account|holding|pot):[0-9a-f-]{36}$/i);
export async function linkGoalPots(goalId: string, refs: string[]) {
  const s = await requireSession();
  uuid.parse(goalId);
  const list = z.array(PotRef).max(12).parse(refs);
  const db = await createClient();
  await db.from("goals").update({ pot_refs: [...new Set(list)] }).eq("id", goalId).eq("household_id", s.householdId);
  done();
  return { ok: true };
}

// ------------------------------------------------------------ hábitos: criar de uma vez as regras sugeridas
const HabitKeys = z.array(z.string().min(1).max(200)).min(1).max(10);
export async function createHabitRules(keys: string[]) {
  const s = await requireSession();
  const want = new Set(HabitKeys.parse(keys));
  const db = await createClient();
  // recalcula no servidor: só vale o que realmente é um hábito seu (não confia no navegador)
  const habits = (await suggestHabits(db, s.householdId, 50)).filter((h) => want.has(h.key));
  if (!habits.length) return { error: "Nada para criar: os hábitos mudaram." };
  const { error } = await db.from("payees").upsert(
    habits.map((h) => ({ household_id: s.householdId, key: h.key, category_id: h.category_id, display_name: h.name })),
    { onConflict: "household_id,key" },
  );
  if (error) return { error: "Não foi possível criar as regras." };
  let applied = 0;
  for (const h of habits) {
    const { data } = await db.from("transactions").update({ category_id: h.category_id, category_source: "payee", confidence: 0.97, status: "ok" })
      .eq("household_id", s.householdId).eq("payee_key", h.key).eq("status", "review").is("deleted_at", null).select("id");
    applied += data?.length ?? 0;
  }
  done();
  return { ok: true, created: habits.length, applied };
}

/** Revisar: cria de uma vez todas as regras sugeridas (palavras-chave que você corrigiu 3 vezes). */
export async function acceptAllRules() {
  const s = await requireSession();
  const db = await createClient();
  const { data } = await db.from("rules").update({ source: "manual", active: true }).eq("household_id", s.householdId).eq("source", "suggested").select("id");
  done();
  return { ok: true, count: data?.length ?? 0 };
}
