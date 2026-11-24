// Utilitários dos testes de ponta a ponta do Fluxo.
// Rodam contra o site local (npm run dev) com o USUÁRIO DE TESTE do .env.test.local — nunca com a sua conta.
import { createServerClient } from "@supabase/ssr";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";

// local por padrão; com --prod usa PROD_URL (o site publicado)
export const BASE = process.argv.includes("--prod") ? process.env.PROD_URL ?? "" : process.env.TEST_BASE_URL ?? "http://localhost:3000";
export const RUN = Date.now().toString(36).slice(-5); // sufixo único por rodada

for (const k of ["TEST_EMAIL", "TEST_PASSWORD", "TEST_TOTP_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
  if (!process.env[k]) { console.error(`Falta ${k} (veja tests/README.md)`); process.exit(2); }
}

let failures = 0;
export const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };
export const done = (label) => { console.log(`\n${label}: ${failures ? `${failures} falha(s)` : "tudo certo"}`); if (failures) process.exitCode = 1; };

/** Código TOTP de 6 dígitos (RFC 6238) a partir do segredo base32. */
export function totp(secret, t = Date.now()) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alpha.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac("sha1", key).update(ctr).digest(); const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

/** Sessão do usuário de teste (senha + 2FA), com os cookies que o site usa. */
export async function login({ mfa = true } = {}) {
  const jar = new Map();
  const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))) },
  });
  const s = await db.auth.signInWithPassword({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD });
  if (s.error) throw new Error("login do usuário de teste falhou: " + s.error.message);
  if (mfa) {
    const { data: f } = await db.auth.mfa.listFactors();
    const v = await db.auth.mfa.challengeAndVerify({ factorId: f.totp[0].id, code: totp(process.env.TEST_TOTP_SECRET) });
    if (v.error) throw new Error("2FA do usuário de teste falhou: " + v.error.message);
  }
  const hid = mfa ? (await db.from("household_members").select("household_id").eq("user_id", s.data.user.id).single()).data?.household_id : null;
  // trava: os testes gravam no banco; nunca rodar numa conta com banco real conectado
  if (hid && !process.env.ALLOW_TESTS_ON_REAL_DATA) {
    const { count } = await db.from("connections").select("id", { count: "exact", head: true }).eq("household_id", hid);
    if (count) { console.error(`ABORTADO: ${process.env.TEST_EMAIL} tem ${count} conexão(ões) bancária(s). Use um usuário só de teste.`); process.exit(3); }
  }
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return { db, jar, hid, cookie };
}

export const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|\u00a0/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

export function http(session) {
  return {
    get: async (p) => { const r = await fetch(BASE + p, { headers: { cookie: session?.cookie() ?? "" }, redirect: "manual" }); return { status: r.status, loc: r.headers.get("location"), text: text(await r.text()) }; },
    post: async (p, body) => { const r = await fetch(BASE + p, { method: "POST", headers: { cookie: session?.cookie() ?? "", "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }); return { status: r.status, json: await r.json().catch(() => ({})) }; },
  };
}

/** Navegador sem janela (Edge ou Chrome instalados; ou PW_BROWSER=caminho). */
export async function browser() {
  const { chromium } = await import("playwright-core");
  const candidates = [process.env.PW_BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
  const executablePath = candidates.find((p) => existsSync(p));
  if (!executablePath) throw new Error("Nenhum Chrome/Edge encontrado. Defina PW_BROWSER com o caminho do navegador.");
  return chromium.launch({ executablePath, headless: true });
}

export const until = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 300) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };

/** Cliente com a chave secreta: só para preparar e limpar dados que o site não deixa o usuário mexer direto. */
export async function adminDb() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
}
