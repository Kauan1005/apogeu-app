import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SetPassword } from "./set-password";
import { TERMS_VERSION } from "@/lib/legal";

// Primeiro acesso de quem foi convidado: cria a senha e segue para o 2FA.
export default async function DefinirSenha() {
  await connection();
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims) redirect("/login");
  // só para o primeiro acesso: quem já tem 2FA troca a senha por outro caminho
  const { data: f } = await db.auth.mfa.listFactors();
  if (f?.totp?.some((x) => x.status === "verified")) redirect("/mfa");
  return <SetPassword email={String(data.claims.email ?? "")} termsVersion={TERMS_VERSION} />;
}
