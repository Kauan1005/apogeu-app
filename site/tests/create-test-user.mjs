// Cria (ou recria) o usuário de TESTE dos testes automáticos, com senha e 2FA gerados aqui e gravados
// só no .env.test.local (nada aparece na tela). Uso: node --env-file=.env.local tests/create-test-user.mjs
// Para apagar depois: node --env-file=.env.local --env-file=.env.test.local tests/delete-test-user.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const EMAIL = "teste@fluxo.test";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

function totp(secret, t = Date.now()) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alpha.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac("sha1", key).update(ctr).digest(); const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
if (list.users.some((u) => u.email === EMAIL)) { console.error("O usuário de teste já existe. Apague antes com tests/delete-test-user.mjs."); process.exit(1); }
const password = `T${randomBytes(18).toString("base64url")}!9`;
await admin.rpc("allow_email", { p_email: EMAIL });
// app_metadata.test_user marca a conta: o script de limpeza só apaga contas com essa marca
const { error } = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true, app_metadata: { test_user: true } });
if (error) { console.error("Erro:", error.message); process.exit(1); }

const jar = new Map();
const db = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
await db.auth.signInWithPassword({ email: EMAIL, password });
const { data: en, error: enErr } = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "testes" });
if (enErr) { console.error("Erro no 2FA:", enErr.message); process.exit(1); }
const v = await db.auth.mfa.challengeAndVerify({ factorId: en.id, code: totp(en.totp.secret) });
if (v.error) { console.error("Erro ao confirmar o 2FA:", v.error.message); process.exit(1); }

const file = ".env.test.local";
let env = existsSync(file) ? readFileSync(file, "utf8") : "# Usuário de TESTE (nunca a sua conta). Não versionar.\n";
const set = (k, val) => { env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${val}`) : `${env.trimEnd()}\n${k}=${val}\n`; };
set("TEST_EMAIL", EMAIL); set("TEST_PASSWORD", password); set("TEST_TOTP_SECRET", en.totp.secret);
writeFileSync(file, env);
console.log("Usuário de teste criado com 2FA; credenciais gravadas em .env.test.local.");
