import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Link de convite (modo casal): valida o token de uso único, abre a sessão e leva para criar a senha.
// Depois da senha vem o cadastro do 2FA (/mfa); sem ele nenhum dado é liberado (RLS exige aal2).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token_hash = url.searchParams.get("token_hash") ?? "";
  const type = url.searchParams.get("type");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token_hash) || (type !== "invite" && type !== "magiclink")) {
    return NextResponse.redirect(new URL("/login?erro=link", url));
  }
  const db = await createClient();
  await db.auth.signOut({ scope: "local" }); // não herda a sessão de outra pessoa no mesmo navegador
  const { error } = await db.auth.verifyOtp({ token_hash, type });
  if (error) return NextResponse.redirect(new URL("/login?erro=link", url));
  return NextResponse.redirect(new URL("/definir-senha", url));
}
