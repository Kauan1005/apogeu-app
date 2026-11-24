import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishable = () =>
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Cliente com a sessão do usuário (RLS aplicada). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(url(), publishable(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // chamado de um Server Component: o proxy renova os cookies
        }
      },
    },
  });
}

/** Cliente de servidor com a chave secreta: ignora RLS. Só para webhook, importação e scripts. */
export function createServiceClient() {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY ausente no .env.local");
  return createAdminClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false, experimental: { passkey: true } } });
}

export type Session = { userId: string; householdId: string; role: "owner" | "member"; email: string; aal: string; mfaAt: number | null; mfaOptional: boolean; passkeySkips: boolean; mfaSkip: boolean };

/** A pessoa desligou a exigência de 2FA da própria conta? (marca gravada só pelo servidor, dentro do JWT) */
export const isMfaOptional = (claims: { app_metadata?: unknown } | null | undefined) => (claims?.app_metadata as { mfa_optional?: boolean } | undefined)?.mfa_optional === true;

/** Biometria que dispensa o código: a conta ligou isso (marca só do servidor) E esta sessão veio de login por passkey. */
export function passkeySkipsMfa(claims: { app_metadata?: unknown; amr?: unknown } | null | undefined) {
  const on = (claims?.app_metadata as { passkey_skips_mfa?: boolean } | undefined)?.passkey_skips_mfa === true;
  const amr = (claims?.amr as { method: string }[] | undefined) ?? [];
  return on && amr.some((m) => m.method === "passkey");
}

/**
 * Exige login com 2FA (aal2) e devolve o household do usuário.
 * Usa getClaims (valida o JWT) em vez de getSession.
 */
export async function requireSession(): Promise<Session> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect("/login");
  const mfaOptional = isMfaOptional(claims);
  const mfaSkip = mfaOptional || passkeySkipsMfa(claims);
  if (claims.aal !== "aal2" && !mfaSkip) redirect("/mfa");
  const { data: member } = await supabase
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", claims.sub)
    .order("role", { ascending: false }) // 'owner' antes de 'member'
    .limit(1)
    .single();
  if (!member) { await supabase.auth.signOut(); redirect("/login?erro=sem-acesso"); }
  const amr = (claims.amr as { method: string; timestamp: number }[] | undefined) ?? [];
  const totp = amr.find((m) => m.method === "totp");
  return { userId: claims.sub, householdId: member.household_id, role: member.role === "owner" ? "owner" : "member", email: String(claims.email ?? ""), aal: claims.aal as string, mfaOptional, mfaSkip, passkeySkips: (claims.app_metadata as { passkey_skips_mfa?: boolean } | undefined)?.passkey_skips_mfa === true, mfaAt: totp?.timestamp ?? null };
}

/** Ações sensíveis (conectar banco, exportar, excluir) pedem 2FA dos últimos 15 minutos. */
export function mfaIsRecent(s: Session, minutes = 15) {
  if (s.mfaOptional) return true; // 2FA desligado pela própria pessoa: não há código para pedir de novo
  return !!s.mfaAt && Date.now() / 1000 - s.mfaAt < minutes * 60;
}
