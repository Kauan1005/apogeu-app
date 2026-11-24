// Testes de segurança: redirecionamento aberto, intruso sem autorização e webhook.
//   npm run test:security
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { BASE, done, ok, totp } from "./lib.mjs";

console.log(`\n== Segurança (${BASE})`);

// 1) redirecionamento depois do 2FA: só caminhos do próprio site (o mfa-form resolve como URL e exige a mesma origem;
//    o teste de ponta a ponta com o navegador está em tests/audit.test.mjs)
const src = readFileSync(new URL("../src/app/mfa/mfa-form.tsx", import.meta.url), "utf8");
ok(src.includes("function safeNext") && src.includes("u.origin === window.location.origin"), "a regra do parâmetro next compara a origem da URL");
const origin = "https://fluxo.example";
const safeNext = (raw) => {
  if (/[\u0000-\u001f\\]/.test(raw)) return "/";
  try { const u = new URL(raw, origin); return u.origin === origin ? u.pathname + u.search + u.hash : "/"; } catch { return "/"; }
};
for (const [v, want] of [["/transacoes", "/transacoes"], ["/ajustes#privacidade", "/ajustes#privacidade"], ["//evil.com", "/"], ["/\\evil.com", "/"], ["https://evil.com", "/"], ["javascript:alert(1)", "/"], ["\t/evil.com", "/"], ["/%09/evil.com", "/%09/evil.com"]]) {
  ok(safeNext(v) === want, `next=${JSON.stringify(v)} → ${want}`);
}

// 2) intruso: conta criada fora da lista de permitidos, com 2FA, não acessa nada
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const key = process.env.SUPABASE_SECRET_KEY;
if (key) {
  const admin = createClient(URL_, key, { auth: { persistSession: false } });
  const email = `intruso-${Date.now()}@fluxo.test`, password = randomBytes(18).toString("base64url");
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) ok(false, "criar intruso: " + error.message);
  else try {
    const jar = new Map();
    const sb = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))) } });
    await sb.auth.signInWithPassword({ email, password });
    const en = await sb.auth.mfa.enroll({ factorType: "totp" });
    await sb.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
    const { count } = await admin.from("household_members").select("user_id", { count: "exact", head: true }).eq("user_id", u.user.id);
    ok(count === 0, "intruso com 2FA não ganha household");
    const { data: tx } = await sb.from("transactions").select("id").limit(1);
    ok(!tx?.length, "intruso não lê nenhuma transação direto no banco");
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(BASE + "/", { headers: { cookie }, redirect: "manual" });
    ok((r.headers.get("location") ?? "").includes("sem-acesso"), `intruso no site → “sem acesso” (${r.status})`);
    const t = await fetch(BASE + "/api/pluggy/connect-token", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}", redirect: "manual" });
    ok(t.status !== 200, `intruso não gera token da Pluggy (${t.status})`);
  } finally {
    await admin.auth.admin.deleteUser(u.user.id);
  }
} else console.log("SKIP  intruso (sem SUPABASE_SECRET_KEY)");

// 3) webhook: segredo só no cabeçalho
const w = await fetch(`${BASE}/api/webhooks/pluggy?s=${process.env.PLUGGY_WEBHOOK_SECRET}`, { method: "POST", body: JSON.stringify({ eventId: "x", event: "item/updated", itemId: "00000000-0000-0000-0000-000000000000" }) });
ok(w.status === 403, `webhook recusa o segredo pela URL (${w.status})`);
const w2 = await fetch(`${BASE}/api/webhooks/pluggy`, { method: "POST", headers: { "x-webhook-secret": "errado" }, body: "{}" });
ok(w2.status === 403, `webhook recusa segredo errado (${w2.status})`);

// 4) CSP com nonce que muda a cada visita
const n1 = (await fetch(BASE + "/login")).headers.get("content-security-policy")?.match(/nonce-([^']+)/)?.[1];
const n2 = (await fetch(BASE + "/login")).headers.get("content-security-policy")?.match(/nonce-([^']+)/)?.[1];
ok(!!n1 && !!n2 && n1 !== n2, "CSP com nonce diferente a cada visita");
done("Segurança");
