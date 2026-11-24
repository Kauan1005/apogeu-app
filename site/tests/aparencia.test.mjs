// Painel resumo, mini-gráficos, tema claro e transição entre telas.
import { BASE, RUN, adminDb, browser, done, http, login, ok, until } from "./lib.mjs";

console.log(`\n== Aparência e Painel resumo (${BASE}) · rodada ${RUN}`);
const admin = await adminDb();
const s = await login();
const h = http(s);
const br = await browser();
let accId = null;
try {
  accId = (await admin.from("accounts").insert({ household_id: s.hid, provider_account_id: `acc-apar-${RUN}`, name: "Conta Aparência", type: "checking", institution: "Teste", balance_cents: 500000 }).select("id").single()).data.id;
  const now = Date.now();
  await admin.from("transactions").insert([
    { household_id: s.hid, account_id: accId, provider_tx_id: `apar-1-${RUN}`, occurred_at: new Date(now - 864e5).toISOString(), amount_cents: -25000, description_raw: `Mercado Apar ${RUN}`, description: `Mercado Apar ${RUN}`, is_internal_transfer: false, status: "ok" },
    { household_id: s.hid, account_id: accId, provider_tx_id: `apar-2-${RUN}`, occurred_at: new Date(now - 2 * 864e5).toISOString(), amount_cents: 400000, description_raw: `Salario Apar ${RUN}`, description: `Salario Apar ${RUN}`, is_internal_transfer: false, status: "ok" },
  ]);

  // resumo simples por padrão; detalhes a um clique
  const resumo = (await h.get("/")).text;
  ok(["Livre para gastar", "Saldo consolidado", "Entradas no mês", "Saídas no mês", "Para onde foi o dinheiro", "Próximas contas", "Atenção", "Ver gráficos e detalhes"].every((t) => resumo.includes(t)), "o Painel é um resumo: livre para gastar, saldo, entradas, saídas, para onde foi, próximas contas e atenção");
  ok(!resumo.includes("Fluxo de caixa") && !resumo.includes("Maiores gastos do mês") && !resumo.includes("Patrimônio líquido"), "sem os gráficos e listas longas (isso fica nos detalhes)");
  const det = (await h.get("/?detalhes=1")).text;
  ok(det.includes("Fluxo de caixa") && det.includes("Maiores gastos do mês") && det.includes("Voltar ao resumo"), "“Ver gráficos e detalhes” abre a versão completa, com volta ao resumo");

  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const p = await ctx.newPage();
  await p.goto(BASE + "/");
  await p.waitForLoadState("networkidle");
  ok((await p.locator("svg.spark").count()) >= 3, "saldo, entradas e saídas ganham mini-gráfico de tendência");
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "o resumo cabe na tela");
  ok((await p.evaluate(() => document.documentElement.dataset.theme)) === "dark", "o tema padrão é o escuro");

  // tema claro: escolhido em Ajustes, guardado em cookie e aplicado sem piscar
  await p.goto(BASE + "/ajustes#aparencia");
  await p.waitForLoadState("networkidle");
  await p.getByRole("radio", { name: "Claro" }).click();
  ok(await until(async () => (await p.evaluate(() => document.documentElement.dataset.theme)) === "light"), "escolher “Claro” troca o tema na hora");
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === "rgb(246, 245, 242)", "com o fundo claro");
  await p.reload();
  await p.waitForLoadState("networkidle");
  ok((await p.evaluate(() => document.documentElement.dataset.theme)) === "light" && (await ctx.cookies()).some((c) => c.name === "apogeu-theme" && c.value === "light"), "a escolha fica guardada (vale ao reabrir)");
  const html = (await fetch(BASE + "/login", { headers: { cookie: "apogeu-theme=light" } }).then((r) => r.text()));
  ok(/data-theme="light"/.test(html), "o servidor já entrega o tema escolhido (sem piscar o escuro)");
  // contraste do texto de apoio no claro (AA, 4.5:1)
  const ratio = await p.evaluate(() => {
    const parse = (c) => c.match(/\d+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const el = document.querySelector(".card .muted");
    const fg = lum(parse(getComputedStyle(el).color)), bgc = lum(parse(getComputedStyle(document.querySelector(".card")).backgroundColor));
    return (Math.max(fg, bgc) + 0.05) / (Math.min(fg, bgc) + 0.05);
  });
  ok(ratio >= 4.5, `texto de apoio com contraste suficiente no tema claro (${ratio.toFixed(1)}:1)`);

  await p.getByRole("radio", { name: "Automático" }).click();
  ok(await until(async () => (await p.evaluate(() => document.documentElement.dataset.theme)) === "auto"), "“Automático” segue o aparelho");
  await p.getByRole("radio", { name: "Escuro" }).click();
  ok(await until(async () => (await p.evaluate(() => document.documentElement.dataset.theme)) === "dark"), "e “Escuro” volta ao padrão");

  // transição entre telas: só opacidade e transform; some com “reduzir movimento”
  const css = await fetch(BASE + (await fetch(BASE + "/login").then((r) => r.text())).match(/\/_next\/static\/[^"]+\.css/)?.[0]).then((r) => r.text());
  ok(/view-transition-new\(\.vt-enter\)/.test(css) && /prefers-reduced-motion:\s*reduce\)\s*\{\s*::view-transition-group/.test(css), "a transição entre telas existe e respeita “reduzir movimento”");
  await ctx.close();
} finally {
  await br.close();
  await admin.from("transactions").delete().like("provider_tx_id", `apar-%-${RUN}`);
  if (accId) await admin.from("accounts").delete().eq("id", accId);
}
done("Aparência e Painel resumo");
