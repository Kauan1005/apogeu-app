// Regressão da auditoria de segurança (2026-11-18): cada ataque encontrado precisa continuar bloqueado.
import { createHmac } from "node:crypto";
import { BASE, RUN, adminDb, browser, done, login, ok, totp, until } from "./lib.mjs";

console.log(`\n== Auditoria de segurança (${BASE}) · rodada ${RUN}`);
const admin = await adminDb();
const s = await login();
const uid = (await s.db.auth.getUser()).data.user.id;

// H1 · ninguém troca a conta Meu Pluggy da casa pelo navegador
const { data: before } = await admin.from("households").select("uses_app_pluggy, name").eq("id", s.hid).single();
const h1 = await s.db.from("households").update({ uses_app_pluggy: !before.uses_app_pluggy }).eq("id", s.hid).select("id");
const { data: after } = await admin.from("households").select("uses_app_pluggy").eq("id", s.hid).single();
ok(!!h1.error && after.uses_app_pluggy === before.uses_app_pluggy, "H1: a casa não consegue trocar a própria conta Meu Pluggy pela API");
const rename = await s.db.from("households").update({ name: before.name }).eq("id", s.hid).select("id");
ok(!rename.error && rename.data?.length === 1, "H1: o dono ainda pode renomear a casa");

// H2 · convite “plantado” pela API não é aceito, e um convite sozinho não captura cadastro
const h2 = await s.db.from("household_invites").insert({ household_id: s.hid, email: `alvo-${RUN}@fluxo.test`, invited_by: uid });
ok(!!h2.error, "H2: convite só pode ser criado pelo servidor (API recusa)");
const { data: planted } = await admin.from("household_invites").insert({ household_id: s.hid, email: `alvo-${RUN}@fluxo.test`, invited_by: uid }).select("id").single();
// simula o cadastro com código: reserva um código real e cria o login como o servidor faz
const { data: sc } = await admin.from("signup_codes").insert({ household_id: s.hid, created_by: uid, code_hash: `audit-${RUN}-${Date.now()}`, hint: "TEST", used_at: new Date().toISOString() }).select("id").single();
const { data: victim } = await admin.auth.admin.createUser({ email: `alvo-${RUN}@fluxo.test`, password: `Vv${Date.now()}!xyzABC`, email_confirm: true, user_metadata: { fluxo_signup: sc.id } });
const { data: vm } = await admin.from("household_members").select("household_id").eq("user_id", victim.user.id);
ok(vm?.length === 1 && vm[0].household_id !== s.hid, "H2: quem se cadastra com código ganha a própria casa, mesmo com convite pendente para o e-mail");
await admin.from("households").delete().eq("id", vm[0].household_id);
await admin.auth.admin.deleteUser(victim.user.id);
await admin.from("household_invites").delete().eq("id", planted.id);
await admin.from("signup_codes").delete().eq("id", sc.id);
// e um código falso/antigo não cria casa
const { data: ghost } = await admin.auth.admin.createUser({ email: `fantasma-${RUN}@fluxo.test`, password: `Gg${Date.now()}!xyzABC`, email_confirm: true, user_metadata: { fluxo_signup: "00000000-0000-4000-8000-000000000000" } });
const { data: gm } = await admin.from("household_members").select("household_id").eq("user_id", ghost.user.id);
ok(!gm?.length, "H2: id de código inexistente não ganha casa");
await admin.auth.admin.deleteUser(ghost.user.id);

// H3 · webhook por casa: cada endereço tem segredo próprio
const hidUrl = `${BASE}/api/webhooks/pluggy/${s.hid}`;
const ev = { eventId: `audit-${RUN}`, event: "item/updated", itemId: "00000000-0000-4000-8000-000000000000" };
const w1 = await fetch(hidUrl, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": process.env.PLUGGY_WEBHOOK_SECRET }, body: JSON.stringify(ev) });
ok(w1.status === 403, "H3: o segredo-mestre não vale no endereço de uma casa");
const derived = createHmac("sha256", process.env.PLUGGY_WEBHOOK_SECRET).update(`webhook:${s.hid}`).digest("hex");
const w2 = await fetch(hidUrl, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": derived }, body: JSON.stringify(ev) });
ok(w2.status === 200, "H3: o segredo derivado da casa é aceito só no endereço dela");
const w3 = await fetch(`${BASE}/api/webhooks/pluggy/${s.hid.replace(/.$/, s.hid.endsWith("0") ? "1" : "0")}`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": derived }, body: JSON.stringify({ ...ev, eventId: `audit2-${RUN}` }) });
ok(w3.status === 403, "H3: o segredo de uma casa não vale em outra");
await admin.from("webhook_events").delete().in("event_id", [`audit-${RUN}`, `audit2-${RUN}`]);

// M1 · apagar histórico de verdade só pelo servidor (o site usa a lixeira)
const { data: anyTx } = await admin.from("transactions").select("id").eq("household_id", s.hid).limit(1).maybeSingle();
if (anyTx) {
  await s.db.from("transactions").delete().eq("id", anyTx.id);
  ok(!!(await admin.from("transactions").select("id").eq("id", anyTx.id).maybeSingle()).data, "M1: a API não apaga transações de vez (só lixeira)");
}
const { data: anyAcc } = await admin.from("accounts").select("id").eq("household_id", s.hid).limit(1).maybeSingle();
if (anyAcc) {
  await s.db.from("accounts").delete().eq("id", anyAcc.id);
  ok(!!(await admin.from("accounts").select("id").eq("id", anyAcc.id).maybeSingle()).data, "M1: a API não apaga contas bancárias");
}

// M3 · conexão com banco só nasce pelo servidor
const m3 = await s.db.from("connections").insert({ household_id: s.hid, provider_item_id: `00000000-0000-4000-9999-${String(Date.now()).slice(-12)}`, institution: `Falsa ${RUN}` });
ok(!!m3.error, "M3: a API não deixa criar conexão com banco");

// M2 · comprovante só dentro da pasta da própria casa
if (anyTx) {
  const m2 = await s.db.from("attachments").insert({ transaction_id: anyTx.id, household_id: s.hid, storage_path: `00000000-0000-4000-8000-000000000000/${anyTx.id}/x.pdf`, filename: "x.pdf" });
  ok(!!m2.error, "M2: não dá para apontar um comprovante para a pasta de outra casa");
}

// L1 · o cofre de backups não é lido direto (só link assinado com 2FA recente)
const { data: listed } = await s.db.storage.from("backups").list(s.hid);
ok(!listed?.length, "L1: o usuário não lista o cofre de backups direto");

// M4 · depois do 2FA, o “next” nunca leva para fora do site
const half = await login({ mfa: false });
const b = await browser();
try {
  const ctx = await b.newContext();
  await ctx.addCookies([...half.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const p = await ctx.newPage();
  await p.goto(`${BASE}/mfa?reauth=1&next=%09/evil.example`);
  let landed = false;
  for (let i = 0; i < 3 && !landed; i++) {
    await p.getByLabel("Código").fill(totp(process.env.TEST_TOTP_SECRET));
    landed = await until(async () => !p.url().includes("/mfa"), 8000);
  }
  ok(landed && new URL(p.url()).origin === new URL(BASE).origin, `M4: “next” malicioso volta para o próprio site (${new URL(p.url()).host})`);
} finally { await b.close(); }

done("Auditoria de segurança");
