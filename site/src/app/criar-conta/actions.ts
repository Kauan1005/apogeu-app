"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { hashSignupCode } from "@/lib/signup";
import { TERMS_VERSION } from "@/lib/legal";

type State = null | { error?: string };
const In = z.object({
  code: z.string().trim().min(12).max(20),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(12, "A senha precisa de pelo menos 12 caracteres.").max(200),
  again: z.string(),
});
const pause = () => new Promise((r) => setTimeout(r, 400)); // freia tentativas de adivinhar códigos

/**
 * Cadastro com código de convite: cada código vale uma conta e vira uma casa nova, com finanças separadas
 * e a conta Meu Pluggy da própria pessoa. Depois de criar, entra e segue para o cadastro do 2FA.
 */
export async function signUp(_: State, form: FormData): Promise<State> {
  const p = In.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues.find((i) => i.path[0] === "password")?.message ?? "Preencha o código, o e-mail e a senha." };
  const { code, email, password, again } = p.data;
  if (password !== again) return { error: "As senhas não conferem." };
  if (/\.(test|example|invalid|localhost)$/.test(email)) return { error: "Use um e-mail de verdade." };
  if (password.toLowerCase().includes(email.split("@")[0])) return { error: "A senha não pode conter o seu e-mail." };

  const admin = createServiceClient();
  // reserva o código (uso único, sem corrida: só um pedido consegue marcar used_at)
  const { data: claimed } = await admin.from("signup_codes").update({ used_at: new Date().toISOString() })
    .eq("code_hash", hashSignupCode(code)).is("used_at", null).gt("expires_at", new Date().toISOString())
    .select("id, household_id").maybeSingle();
  if (!claimed) { await pause(); return { error: "Código de convite inválido, vencido ou já usado." }; }
  const release = () => admin.from("signup_codes").update({ used_at: null }).eq("id", claimed.id);

  // o id do código reservado faz o banco criar uma casa nova, com a conta Meu Pluggy da própria pessoa
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { fluxo_signup: claimed.id, terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() } });
  if (error || !created?.user) {
    await release();
    // mesma mensagem para e-mail já cadastrado e outros erros (não revela quem tem conta)
    return { error: error?.message?.toLowerCase().includes("password") ? "Senha fraca demais. Misture letras, números e símbolos." : "Não foi possível criar a conta com esse e-mail." };
  }
  await admin.from("signup_codes").update({ used_by: created.user.id }).eq("id", claimed.id);
  await admin.from("audit_log").insert({ household_id: claimed.household_id, actor: null, table_name: "signup_code", action: "update", diff: { used: true } });

  const db = await createClient();
  await db.auth.signInWithPassword({ email, password });
  redirect("/mfa?next=/comecar"); // depois do 2FA, o passo a passo do Meu Pluggy
}
