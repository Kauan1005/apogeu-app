// Sugestões de regras pelos hábitos (Revisar) e 2FA opcional: ligar e desligar em Ajustes, com o banco (RLS) obedecendo.
import { BASE, RUN, adminDb, browser, done, http, login, ok, until } from "./lib.mjs";

console.log(`\n== Hábitos e 2FA opcional (${BASE}) · rodada ${RUN}`);
const admin = await adminDb();
const s = await login();
const memberId = (await admin.from("household_members").select("user_id").eq("household_id", s.hid).limit(1).single()).data.user_id;
const { data: cats } = await admin.from("categories").select("id, slug").eq("household_id", s.hid);
const cat = (slug) => cats.find((c) => c.slug === slug).id;
const br = await browser();
let accId = null;

try {
  // ------------------------------------------------------------ hábitos: sempre na mesma categoria viram regra de uma vez
  accId = (await admin.from("accounts").insert({ household_id: s.hid, provider_account_id: `acc-hab-${RUN}`, name: "Conta Hábito", type: "checking", institution: "Teste" }).select("id").single()).data.id;
  const key = `d:habito ${RUN}`, nome = `Padaria Habito ${RUN}`;
  const row = (n, extra) => ({ household_id: s.hid, account_id: accId, provider_tx_id: `hab-${n}-${RUN}`, occurred_at: new Date(Date.now() - n * 864e5).toISOString(), amount_cents: -1500, description_raw: nome, description: nome, counterpart_name: nome, payee_key: key, is_internal_transfer: false, ...extra });
  await admin.from("transactions").insert([
    row(1, { category_id: cat("alimentacao"), category_source: "user", status: "ok" }),
    row(2, { category_id: cat("alimentacao"), category_source: "user", status: "ok" }),
    row(3, { category_id: cat("lazer"), category_source: "none", status: "review" }),
  ]);
  // duas regras sugeridas por palavra-chave, para o "criar todas"
  await admin.from("rules").insert([1, 2].map((n) => ({ household_id: s.hid, name: `“habitoregra${n}${RUN}” → categoria`, source: "suggested", category_id: cat("lazer"), conditions: [{ field: "description", op: "contains", value: `habitoregra${n}${RUN}` }] })));

  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const p = await ctx.newPage();
  await p.goto(BASE + "/revisar");
  await p.waitForLoadState("networkidle");
  const hab = p.locator(".card", { hasText: "Seus hábitos" });
  ok(await until(async () => (await hab.count()) === 1 && (await hab.innerText()).includes(nome)), "Revisar mostra “Seus hábitos”: destinatário que você sempre põe na mesma categoria");
  ok((await hab.innerText()).includes("Alimentação") && (await hab.innerText()).includes("2×"), "com a categoria e quantas vezes você fez igual");
  await hab.getByRole("button", { name: /Criar (esta regra|estas \d+ regras)/ }).click();
  ok(await until(async () => !!(await admin.from("payees").select("key").eq("household_id", s.hid).eq("key", key).maybeSingle()).data), "um toque cria a regra do destinatário");
  const rev = (await admin.from("transactions").select("status, category_id, category_source").eq("household_id", s.hid).eq("provider_tx_id", `hab-3-${RUN}`).single()).data;
  ok(rev.status === "ok" && rev.category_id === cat("alimentacao") && rev.category_source === "payee", "e já resolve o que estava na fila de revisão desse destinatário");
  await p.reload();
  await p.waitForLoadState("networkidle");
  ok((await p.locator(".card", { hasText: nome }).filter({ hasText: "Seus hábitos" }).count()) === 0, "depois de criada, a sugestão some");
  await p.getByRole("button", { name: /Criar as \d+/ }).click();
  ok(await until(async () => ((await admin.from("rules").select("id").eq("household_id", s.hid).eq("source", "suggested").like("name", `%habitoregra%${RUN}%`)).data ?? []).length === 0), "“Criar as N” transforma todas as regras sugeridas em regras de verdade");

  // ------------------------------------------------------------ 2FA: ligar e desligar, com o banco obedecendo
  const flag = async () => (await admin.auth.admin.getUserById(memberId)).data.user.app_metadata?.mfa_optional === true;
  const novoLogin = () => login({ mfa: false }); // sessão só com senha (aal1)
  ok(!(await flag()), "por padrão o 2FA é exigido");
  const s1 = await novoLogin();
  const bloqueada = await http(s1).get("/");
  const linhas0 = (await s1.db.from("household_members").select("household_id")).data ?? [];
  ok(bloqueada.status === 307 && /\/mfa/.test(bloqueada.loc ?? "") && linhas0.length === 0, "só com a senha: o site manda para o código e o banco não entrega dados");
  // ninguém liga isso sozinho pelo navegador (metadata do usuário não vale)
  await s1.db.auth.updateUser({ data: { mfa_optional: true } });
  await s1.db.auth.refreshSession();
  const linhasHack = (await s1.db.from("household_members").select("household_id")).data ?? [];
  ok(linhasHack.length === 0 && (await http(s1).get("/")).status === 307, "alterar os próprios dados pelo navegador não desliga o 2FA (a marca só o servidor grava)");

  await p.goto(BASE + "/ajustes#seguranca");
  await p.waitForLoadState("networkidle");
  const card = p.locator("#seguranca");
  ok(await until(async () => (await card.locator(".st", { hasText: "Ligada" }).count()) === 1), "Ajustes mostra a Verificação em duas etapas como Ligada");
  await card.getByRole("button", { name: "Desligar…" }).click();
  const dlg = p.locator("dialog[open]");
  const botao = dlg.getByRole("button", { name: "Desligar", exact: true });
  ok(await botao.isDisabled() && (await dlg.innerText()).includes("qualquer pessoa que descubra seu e-mail"), "desligar explica o risco e fica travado até você marcar que entende");
  await dlg.getByRole("checkbox").check();
  await botao.click();
  ok(await until(async () => (await card.locator(".st", { hasText: "Desligada" }).count()) === 1), "confirmando, o 2FA fica Desligado");
  ok(await flag(), "a marca é gravada pelo servidor na conta");
  const s2 = await novoLogin();
  const livre = await http(s2).get("/");
  const linhas2 = (await s2.db.from("household_members").select("household_id")).data ?? [];
  ok(livre.status === 200 && linhas2.length > 0, "com o 2FA desligado, entrar só com a senha chega direto ao site e o banco libera os dados");
  const logs = (await admin.from("audit_log").select("table_name").eq("household_id", s.hid).eq("table_name", "mfa_desligado")).data ?? [];
  ok(logs.length >= 1, "o desligamento fica registrado no histórico de atividade");

  await card.getByRole("button", { name: "Ligar", exact: true }).click();
  ok(await until(async () => !(await flag())), "Ligar volta a exigir o código");
  const s3 = await novoLogin();
  ok((await http(s3).get("/")).status === 307 && ((await s3.db.from("household_members").select("household_id")).data ?? []).length === 0, "e de novo só com a senha não entra");
  const logsOn = (await admin.from("audit_log").select("table_name").eq("household_id", s.hid).eq("table_name", "mfa_ligado")).data ?? [];
  ok(logsOn.length >= 1, "o religamento também fica no histórico");

  // ------------------------------------------------------------ biometria: a tela diz em que pé está
  await p.goto(BASE + "/ajustes#seguranca");
  await p.waitForLoadState("networkidle");
  const st = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } }).then((r) => r.json());
  const pk = p.locator("#seguranca");
  ok(await until(async () => st.passkeys_enabled ? (await pk.getByRole("button", { name: /Cadastrar/ }).count()) === 1 : (await pk.innerText()).includes("ainda não está ligada")), st.passkeys_enabled ? "biometria ligada no servidor: Ajustes oferece cadastrar neste aparelho" : "biometria ainda desligada no servidor: Ajustes explica o que falta ligar");
  await ctx.close();
} finally {
  await admin.auth.admin.updateUserById(memberId, { app_metadata: { mfa_optional: false } });
  await br.close();
  await admin.from("transactions").delete().like("provider_tx_id", `hab-%-${RUN}`);
  await admin.from("payees").delete().eq("household_id", s.hid).eq("key", `d:habito ${RUN}`);
  await admin.from("rules").delete().eq("household_id", s.hid).like("name", `%habitoregra%${RUN}%`);
  if (accId) await admin.from("accounts").delete().eq("id", accId);
}
done("Hábitos e 2FA opcional");
