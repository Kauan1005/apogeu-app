import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/** Biometria que dispensa o código: a conta ligou (marca só do servidor) E a sessão veio de login por passkey. */
const passkeySkipsMfa = (claims: { app_metadata?: unknown; amr?: unknown } | null | undefined) =>
  (claims?.app_metadata as { passkey_skips_mfa?: boolean } | undefined)?.passkey_skips_mfa === true
  && ((claims?.amr as { method: string }[] | undefined) ?? []).some((m) => m.method === "passkey");

/** CSP com nonce por requisição: só scripts do Next (marcados com o nonce) e os que eles carregam rodam. */
function csp(nonce: string) {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // estilos inline (atributos style) não executam código
    "img-src 'self' data: blob: https://*.pluggy.ai",
    "font-src 'self' data:",
    `connect-src 'self' ${SUPABASE} ${SUPABASE.replace("https://", "wss://")} https://*.pluggy.ai`,
    "frame-src https://*.pluggy.ai",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

// Renova a sessão do Supabase a cada requisição, aplica a CSP e faz o redirecionamento otimista para /login e /mfa.
// A autorização de verdade fica no servidor (requireSession) e no banco (RLS exige aal2).
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = csp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const next = () => {
    const r = NextResponse.next({ request: { headers: requestHeaders } });
    r.headers.set("Content-Security-Policy", policy);
    return r;
  };

  let response = next();
  const supabase = createServerClient(
    SUPABASE,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          requestHeaders.set("cookie", request.cookies.toString());
          response = next();
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith("/login") || path.startsWith("/api/webhooks") || path.startsWith("/api/cron") || path === "/api/backup/export" || path === "/auth/confirm" || path === "/criar-conta" || path === "/offline" || path === "/api/health"
    || path === "/privacidade" || path === "/termos" || path === "/instalar" || path === "/.well-known/security.txt" || path === "/.well-known/assetlinks.json";
  // /mfa e /definir-senha funcionam antes do 2FA (primeiro acesso de quem foi convidado)
  const isMfa = path.startsWith("/mfa") || path === "/definir-senha";

  if (!claims && !isPublic) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const mfaOptional = (claims?.app_metadata as { mfa_optional?: boolean } | undefined)?.mfa_optional === true || passkeySkipsMfa(claims);
  if (claims && claims.aal !== "aal2" && !mfaOptional && !isMfa && !isPublic) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "mfa_required" }, { status: 401 });
    return NextResponse.redirect(new URL("/mfa", request.url));
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|apogeu.apk|.well-known/assetlinks.json|.*\\.(?:svg|png|jpg|webp)$).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }],
    },
  ],
};
