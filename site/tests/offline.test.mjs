// Abrir sem internet: resumo guardado só no aparelho (só totais), tela /offline pública, bloqueio por inatividade,
// chave em Ajustes e (em produção, com HTTPS) o service worker servindo a tela sem rede.
import { BASE, RUN, adminDb, browser, done, login, ok, until } from "./lib.mjs";
import { startProxy } from "./proxy.mjs";

console.log(`\n== Abrir sem internet (${BASE}) · rodada ${RUN}`);
const admin = await adminDb();
const anon = await fetch(BASE + "/offline", { redirect: "manual" });
ok(anon.status === 200 && !(await anon.text()).includes("Livre para gastar"), "a tela /offline é pública e não carrega dado nenhum");

const s = await login();
const br = await browser();
let accId = null;
try {
  accId = (await admin.from("accounts").insert({ household_id: s.hid, provider_account_id: `acc-off-${RUN}`, name: "Conta Offline", type: "checking", institution: "Teste", balance_cents: 250000 }).select("id").single()).data.id;
  const { data: cats } = await admin.from("categories").select("id, slug").eq("household_id", s.hid);
  await admin.from("transactions").insert([
    { household_id: s.hid, account_id: accId, provider_tx_id: `off-1-${RUN}`, occurred_at: new Date(Date.now() - 864e5).toISOString(), amount_cents: -31000, description_raw: `Segredo Privado ${RUN}`, description: `Segredo Privado ${RUN}`, category_id: cats.find((c) => c.slug === "alimentacao").id, category_source: "user", is_internal_transfer: false, status: "ok" },
    { household_id: s.hid, account_id: accId, provider_tx_id: `off-2-${RUN}`, occurred_at: new Date(Date.now() - 2 * 864e5).toISOString(), amount_cents: 120000, description_raw: `Entrada Offline ${RUN}`, description: `Entrada Offline ${RUN}`, category_id: cats.find((c) => c.slug === "salario").id, category_source: "user", is_internal_transfer: false, status: "ok" },
  ]);
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const p = await ctx.newPage();
  const snap = () => p.evaluate(() => localStorage.getItem("apogeu-snap"));

  await p.goto(BASE + "/");
  await p.waitForLoadState("networkidle");
  ok(await until(async () => !!(await snap())), "abrir o Painel guarda o resumo neste aparelho");
  const j = JSON.parse(await snap());
  ok(Number.isInteger(j.balance) && j.expense >= 31000 && j.income >= 120000 && typeof j.savedAt === "number" && j.cats.some((c) => c.label === "Alimentação"), "com saldo, entradas, saídas e categorias (os valores desta rodada entram no total)");
  ok(!(await snap()).includes("Segredo Privado") && !(await snap()).includes("Entrada Offline"), "mas sem o nome de nenhum lançamento");

  // a tela /offline mostra o que foi guardado
  await p.goto(BASE + "/offline");
  await p.waitForLoadState("networkidle");
  const txt = async () => (await p.locator("main").innerText()).replace(/ /g, " ");
  ok(await until(async () => (await txt()).includes("Sem internet") && (await txt()).includes("dados de hoje")), "a tela sem internet avisa e diz de quando são os dados");
  const brlTxt = (c) => "R$ " + Math.abs(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ok((await txt()).includes(brlTxt(j.balance)) && (await txt()).includes("Alimentação"), "e mostra saldo e categorias guardados");

  // parado há mais de 2 horas: apaga e não mostra
  await p.evaluate(() => localStorage.setItem("apogeu-last-activity", String(Date.now() - 121 * 60 * 1000)));
  await p.reload();
  await p.waitForLoadState("networkidle");
  ok(await until(async () => (await txt()).includes("Não há dados guardados")), "depois de 2 horas parado, a tela não mostra nada");
  ok(!(await snap()), "e o resumo guardado é apagado");

  // chave em Ajustes
  await p.goto(BASE + "/");
  await p.waitForLoadState("networkidle");
  ok(await until(async () => !!(await snap())), "voltando ao Painel o resumo é guardado de novo");
  await p.goto(BASE + "/ajustes#aparencia");
  await p.waitForLoadState("networkidle");
  const sec = p.locator("#aparencia");
  ok(await until(async () => (await sec.getByText("Ligado", { exact: true }).count()) === 1), "Ajustes mostra “Abrir sem internet” ligado");
  await sec.getByRole("button", { name: "Desligar", exact: true }).click();
  ok(await until(async () => !(await snap())) && (await p.evaluate(() => localStorage.getItem("apogeu-offline"))) === "0", "desligar apaga o resumo guardado");
  await p.goto(BASE + "/");
  await p.waitForLoadState("networkidle");
  await p.waitForTimeout(1200);
  ok(!(await snap()), "com a chave desligada o Painel não guarda mais nada");
  await p.goto(BASE + "/ajustes#aparencia");
  await p.waitForLoadState("networkidle");
  await sec.getByRole("button", { name: "Ligar", exact: true }).click();
  await p.goto(BASE + "/");
  ok(await until(async () => !!(await snap())), "ligar de novo volta a guardar");

  // sair apaga
  await p.getByRole("button", { name: /Sair/ }).first().click().catch(async () => { await p.goto(BASE + "/mais"); await p.getByRole("button", { name: /Sair/ }).first().click(); });
  ok(await until(async () => new URL(p.url()).pathname === "/login"), "Sair leva ao login");
  ok(!(await snap()), "e o resumo guardado é apagado ao sair");
  await ctx.close();

  // service worker: o site passa por um proxy local que eu desligo no meio do teste (o setOffline do Playwright
  // não derruba a rede do próprio service worker). localhost conta como contexto seguro, então o SW roda aqui também.
  if (!BASE.startsWith("https://")) console.log("SKIP  service worker sem rede: roda contra o site publicado (o servidor de desenvolvimento não hidrata atrás de proxy)");
  else {
    const proxy = await startProxy(BASE);
    try {
      const origin = `http://localhost:${proxy.port}`;
      const c2 = await br.newContext({ viewport: { width: 390, height: 844 } });
      const s2 = await login(); // "Sair" encerrou todas as sessões deste usuário: entra de novo
      await c2.addCookies([...s2.jar].map(([name, value]) => ({ name, value, url: origin })));
      const q = await c2.newPage();
      await q.goto(origin + "/");
      await q.waitForLoadState("networkidle");
      await q.evaluate(() => navigator.serviceWorker.register("/sw.js"));
      await q.evaluate(() => navigator.serviceWorker.ready);
      await q.reload(); // agora a página é controlada pelo service worker e o Painel guarda o resumo e os arquivos
      await q.waitForLoadState("networkidle");
      const cached = () => q.evaluate(async () => { const c = await caches.open("apogeu-static-v4"); const ks = (await c.keys()).map((k) => new URL(k.url).pathname); return { offline: ks.includes("/offline"), assets: ks.filter((k) => k.startsWith("/_next/static/")).length }; });
      ok(await until(async () => { const c = await cached(); return c.offline && c.assets >= 3; }, 40000), "o app deixa a tela /offline e os arquivos dela guardados no aparelho");
      ok(!!(await q.evaluate(() => localStorage.getItem("apogeu-snap"))), "junto com o resumo do Painel");
      proxy.setUp(false); // internet cai
      await q.goto(origin + "/").catch(() => {});
      const off = async () => (await q.locator("main").innerText().catch(() => "")).replace(/ /g, " ");
      const brlTxt = (c) => "R$ " + Math.abs(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const j = JSON.parse(await q.evaluate(() => localStorage.getItem("apogeu-snap")));
      ok(await until(async () => (await off()).includes("Sem internet"), 20000), "sem rede, abrir o app mostra a tela sem internet");
      ok(await until(async () => (await off()).includes(brlTxt(j.balance)), 20000), "e ela já mostra o resumo guardado (os arquivos da tela vêm do aparelho)");
      await q.goto(origin + "/transacoes").catch(() => {});
      ok(await until(async () => (await off()).includes("Sem internet"), 20000), "qualquer página do app cai na tela sem internet, não numa página de erro");
      proxy.setUp(true); // internet volta
      await q.goto(origin + "/").catch(() => {});
      ok(await until(async () => !(await off()).includes("Sem internet") && (await q.locator(".hero").count()) > 0, 20000), "com a rede de volta o app abre normal (a rede sempre manda)");
      await c2.close();
    } finally { await proxy.close(); }
  }
} finally {
  await br.close();
  await admin.from("transactions").delete().like("provider_tx_id", `off-%-${RUN}`);
  if (accId) await admin.from("accounts").delete().eq("id", accId);
}
done("Abrir sem internet");
