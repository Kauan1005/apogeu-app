"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { PluggyClient } from "pluggy-sdk";
import { createServiceClient, mfaIsRecent, requireSession } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { hashSignupCode } from "@/lib/signup";
import { householdWebhookSecret } from "@/lib/webhook";
import { pluggyFor } from "@/lib/pluggy";

type Result = { ok?: boolean; error?: string; reauth?: boolean; code?: string; message?: string };
const done = () => revalidatePath("/", "layout");
const audit = (hid: string, actor: string, table_name: string, action: string, diff: Record<string, unknown> = {}) =>
  createServiceClient().from("audit_log").insert({ household_id: hid, actor, table_name, action, diff });

// ------------------------------------------------------------ códigos de convite (conta nova, finanças separadas)
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O e 1/I

export async function createSignupCode(): Promise<Result> {
  const s = await requireSession();
  if (s.role !== "owner") return { error: "Só o dono da conta gera códigos de convite." };
  if (!mfaIsRecent(s)) return { reauth: true };
  const admin = createServiceClient();
  const { count } = await admin.from("signup_codes").select("id", { count: "exact", head: true })
    .eq("household_id", s.householdId).is("used_at", null).gt("expires_at", new Date().toISOString());
  if ((count ?? 0) >= 5) return { error: "Já existem 5 códigos ativos. Cancele um antes de gerar outro." };
  const raw = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  const { error } = await admin.from("signup_codes").insert({ household_id: s.householdId, created_by: s.userId, code_hash: hashSignupCode(code), hint: raw.slice(-4) });
  if (error) return { error: "Não foi possível gerar o código." };
  await audit(s.householdId, s.userId, "signup_code", "insert", { hint: raw.slice(-4) });
  done();
  return { ok: true, code };
}

export async function cancelSignupCode(id: string): Promise<Result> {
  const s = await requireSession(); z.string().uuid().parse(id);
  if (s.role !== "owner") return { error: "Só o dono da conta cancela códigos." };
  const admin = createServiceClient();
  await admin.from("signup_codes").delete().eq("id", id).eq("household_id", s.householdId).is("used_at", null);
  await audit(s.householdId, s.userId, "signup_code", "delete");
  done();
  return { ok: true };
}

// ------------------------------------------------------------ conta Meu Pluggy da casa
async function siteOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`;
}

const CredIn = z.object({
  client_id: z.string().trim().uuid("O client_id tem o formato 00000000-0000-0000-0000-000000000000."),
  client_secret: z.string().trim().min(20, "client_secret curto demais.").max(200).regex(/^\S+$/, "client_secret não pode ter espaços."),
});

/** Confere as credenciais na própria Pluggy, cadastra o webhook do site nelas e guarda tudo cifrado. */
export async function savePluggyCredentials(_: unknown, form: FormData): Promise<Result> {
  const s = await requireSession();
  if (s.role !== "owner") return { error: "Só o dono da conta cadastra a conta Meu Pluggy." };
  if (!mfaIsRecent(s)) return { reauth: true };
  const admin = createServiceClient();
  const { data: hh } = await admin.from("households").select("uses_app_pluggy").eq("id", s.householdId).single();
  if (hh?.uses_app_pluggy) return { error: "Esta casa usa a conta Meu Pluggy do administrador do site." };
  const p = CredIn.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Credenciais inválidas." };
  const { client_id, client_secret } = p.data;
  if (client_id === process.env.PLUGGY_CLIENT_ID) return { error: "Essa é a conta Meu Pluggy do administrador. Use a sua própria." };

  const client = new PluggyClient({ clientId: client_id, clientSecret: client_secret });
  let webhook = "não cadastrado (site local)";
  try {
    const { results } = await client.fetchWebhooks(); // falha se a Pluggy não aceitar as credenciais
    const base = await siteOrigin();
    if (base.startsWith("https://") && process.env.PLUGGY_WEBHOOK_SECRET) {
      // endereço e segredo só desta casa: quem controla a conta Meu Pluggy não descobre o segredo de mais ninguém
      const url = `${base}/api/webhooks/pluggy/${s.householdId}`;
      for (const w of results.filter((w) => w.url.startsWith(`${base}/api/webhooks/pluggy`))) await client.deleteWebhook(w.id);
      await client.createWebhook("all", url, { "x-webhook-secret": householdWebhookSecret(s.householdId) });
      webhook = "cadastrado";
    }
  } catch {
    return { error: "A Pluggy não aceitou essas credenciais. Confira o client_id e o client_secret no painel do Meu Pluggy." };
  }
  const { error } = await admin.from("pluggy_credentials").upsert({
    household_id: s.householdId, client_id_enc: encrypt(client_id), client_secret_enc: encrypt(client_secret),
    client_id_hint: client_id.slice(-4), created_by: s.userId, updated_at: new Date().toISOString(),
  });
  if (error) return { error: "Não foi possível salvar." };
  await audit(s.householdId, s.userId, "pluggy_credentials", "update", { hint: client_id.slice(-4) });
  done();
  return { ok: true, message: `Conta Meu Pluggy salva. Webhook ${webhook}.` };
}

export async function removePluggyCredentials(): Promise<Result> {
  const s = await requireSession();
  if (s.role !== "owner") return { error: "Só o dono da conta pode remover." };
  if (!mfaIsRecent(s)) return { reauth: true };
  try {
    const client = await pluggyFor(s.householdId);
    const { results } = await client.fetchWebhooks();
    for (const w of results.filter((w) => w.url.includes(`/api/webhooks/pluggy/${s.householdId}`))) await client.deleteWebhook(w.id);
  } catch { /* chaves já inválidas: segue apagando */ }
  await createServiceClient().from("pluggy_credentials").delete().eq("household_id", s.householdId);
  await audit(s.householdId, s.userId, "pluggy_credentials", "delete");
  done();
  return { ok: true };
}

// ------------------------------------------------------------ 2FA: ligar e desligar a exigência
/**
 * Desligar pede o código do autenticador dos últimos 15 minutos e a confirmação do risco; ligar é sempre permitido.
 * A marca fica em app_metadata.mfa_optional (só o servidor grava) e vale no banco (RLS), no proxy e nas telas.
 */
/**
 * Entrar só com a biometria, sem pedir o código do autenticador (vale só para sessões abertas por passkey).
 * Ligar pede o código recente e a confirmação do risco; desligar é livre (só aumenta a proteção).
 * Ações sensíveis (conectar banco, exportar, excluir) continuam pedindo o código.
 */
/** Remove uma biometria da própria conta (pelo servidor: o navegador não consegue apagar quando a sessão não tem 2FA). */
export async function removePasskey(passkeyId: string): Promise<Result> {
  const s = await requireSession();
  const admin = createServiceClient().auth.admin.passkey;
  const { data: mine } = await admin.listPasskeys({ userId: s.userId });
  if (!((mine ?? []) as { id: string }[]).some((p) => p.id === passkeyId)) return { error: "Biometria não encontrada." };
  const { error } = await admin.deletePasskey({ userId: s.userId, passkeyId });
  if (error) return { error: "Não foi possível remover agora." };
  await audit(s.householdId, s.userId, "passkey_del", "update");
  done();
  return { ok: true };
}

export async function setPasskeySkipsMfa(on: boolean, confirm = false): Promise<Result> {
  const s = await requireSession();
  if (on) {
    if (!mfaIsRecent(s)) return { reauth: true };
    if (!confirm) return { error: "Confirme que entende o risco para ligar." };
  }
  if (on === s.passkeySkips) return { ok: true };
  const { error } = await createServiceClient().auth.admin.updateUserById(s.userId, { app_metadata: { passkey_skips_mfa: on } });
  if (error) return { error: "Não foi possível alterar agora." };
  await audit(s.householdId, s.userId, on ? "biometria_sem_codigo_ligada" : "biometria_sem_codigo_desligada", "update");
  done();
  return { ok: true };
}

export async function setTwoFactorRequired(required: boolean, confirm = false): Promise<Result> {
  const s = await requireSession();
  if (!required) {
    if (!mfaIsRecent(s)) return { reauth: true };
    if (!confirm) return { error: "Confirme que entende o risco para desligar." };
  }
  if (required === !s.mfaOptional) return { ok: true }; // já está assim
  const { error } = await createServiceClient().auth.admin.updateUserById(s.userId, { app_metadata: { mfa_optional: !required } });
  if (error) return { error: "Não foi possível alterar agora." };
  await audit(s.householdId, s.userId, required ? "mfa_ligado" : "mfa_desligado", "update");
  done();
  return { ok: true };
}

/** Registra no histórico quando uma biometria é cadastrada ou removida. */
export async function logSecurityEvent(kind: "passkey_add" | "passkey_del"): Promise<Result> {
  const s = await requireSession();
  z.enum(["passkey_add", "passkey_del"]).parse(kind);
  await audit(s.householdId, s.userId, kind, "update");
  return { ok: true };
}
