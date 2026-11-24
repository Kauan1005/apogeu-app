// Testes pela interface (cliques reais num navegador sem janela).
import { fileURLToPath } from "node:url";
import { BASE, RUN, browser, done, http, login, ok, until } from "./lib.mjs";
import { adminDb } from "./lib.mjs";

console.log(`\n== Interface (${BASE}) · rodada ${RUN}`);
const s = await login();
const h = http(s);
const sim = (b) => h.post("/api/dev/simulate-pix", b).then((r) => r.json.transaction);
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("dialog", (d) => d.accept());
const main = () => page.locator("main").innerText();
const row = (name) => page.locator("tbody tr", { hasText: name }).first();
let eduHadBudget = true; // na dúvida, não apaga

try {
  // ---------- categoria na célula da tabela + “lembrar destinatário” + embedding (IA gte-small)
  const pizza = `Pizzaria Bella Napoli ${RUN}`;
  await sim({ name: pizza, amount: 80 });
  await page.goto(BASE + "/transacoes");
  await row(pizza).locator("select").selectOption({ label: "Alimentação" });
  ok(await until(async () => (await row(pizza).textContent()).includes("Você")), "trocar a categoria na célula da tabela salva (classificação “Você”)");
  const { data: px } = await s.db.from("transactions").select("id").ilike("description", pizza).single();
  const emb = await until(async () => !!(await s.db.from("tx_embeddings").select("transaction_id").eq("transaction_id", px.id).maybeSingle()).data, 15000);
  ok(emb, "a correção guarda o embedding gte-small da transação (IA no Supabase)");
  const cantina = await sim({ name: `Cantina Napolitana Massas ${RUN}`, amount: 95 });
  ok(cantina?.category_source === "similarity" && cantina?.categories?.name === "Alimentação",
    `Pix parecido (“Cantina Napolitana Massas”) → ${cantina?.categories?.name} por ${cantina?.category_source} (${cantina?.confidence})`);

  // ---------- a tabela atualiza sozinha (5s) sem recarregar nem perder o filtro
  await page.goto(BASE + "/transacoes");
  let navs = 0;
  const onNav = () => { navs++; }; // só recarga completa (evento load); atualizações internas do Next não contam
  page.on("load", onNav);
  await page.getByLabel("Categoria").first().selectOption({ label: "Categoria: todas" });
  await page.getByLabel("Agrupar por").getByRole("button", { name: "Categoria", exact: true }).click(); // agrupar por categoria (estado da tela)
  await page.evaluate(() => { document.querySelector(".toolbar").dataset.marca = "mesma-tela"; });
  const auto = `Auto Atualizacao ${RUN}`;
  await sim({ name: auto, amount: 12.34 });
  ok(await until(async () => (await page.locator("tbody tr", { hasText: auto }).count()) > 0, 12000), "um Pix novo aparece sozinho na tabela em até ~5s");
  ok(navs === 0, `a página não recarregou (navegações: ${navs})`);
  ok(await page.evaluate(() => document.querySelector(".toolbar")?.dataset.marca === "mesma-tela"), "a tela continuou a mesma (sem piscar nem remontar)");
  ok((await page.getByLabel("Agrupar por").getByRole("button", { name: "Categoria", exact: true }).getAttribute("aria-pressed")) === "true", "o agrupamento escolhido continua aplicado");
  page.off("load", onNav);

  // ---------- Revisar: Enter confirma a sugestão, número escolhe categoria (usa o que estiver na fila)
  await sim({ name: `Fornecedor ${RUN}`, amount: 33, direction: "in" });
  await page.goto(BASE + "/revisar");
  await page.waitForLoadState("networkidle");
  const queued = await page.locator(".q").count();
  if (queued < 2) console.log("SKIP  Revisar: fila com menos de 2 itens");
  else {
    const name1 = (await page.locator(".q").first().locator("span").first().innerText()).trim();
    await page.keyboard.press("Enter");
    ok(await until(async () => (await page.locator(".note").count()) > 0), `Revisar: Enter confirma a sugestão de “${name1}”`);
    await page.reload();
    await page.waitForLoadState("networkidle");
    const name2 = (await page.locator(".q").first().locator("span").first().innerText()).trim();
    const opt1 = (await page.locator(".opt").first().innerText()).split(String.fromCharCode(10))[0].trim();
    await page.keyboard.press("1");
    ok(await until(async () => (await page.locator(".note").innerText().catch(() => "")).includes(opt1)), `Revisar: tecla 1 põe “${name2}” em “${opt1}”`);
  }

  // ---------- detalhes: anotação, tags, divisão e comprovante
  await page.goto(BASE + "/transacoes");
  await row(pizza).getByRole("button", { name: /Detalhes/ }).click();
  const dlg = page.locator("dialog[open]");
  await dlg.getByLabel("Anotação").fill(`aniversário ${RUN}`);
  await dlg.getByLabel(/Tags/).fill("família, fim de semana");
  await dlg.getByRole("button", { name: "Adicionar parte" }).click();
  await dlg.getByRole("button", { name: "Adicionar parte" }).click();
  const parts = dlg.locator("input[placeholder='Valor']");
  await parts.nth(0).fill("50"); await parts.nth(1).fill("30");
  await dlg.locator("select").nth(1).selectOption({ label: "Lazer" });
  await dlg.locator("input[type=file]").setInputFiles(fileURLToPath(new URL("../public/icons/icon-192.png", import.meta.url)));
  await until(async () => !!(await s.db.from("attachments").select("id").eq("transaction_id", px.id).maybeSingle()).data, 15000);
  await dlg.getByRole("button", { name: "Salvar" }).click();
  ok(await until(async () => (await page.locator("dialog[open]").count()) === 0), "salvar detalhes fecha a janela");
  await page.reload();
  const r = await row(pizza).textContent(); // tags ficam em coluna escondida abaixo de 1600px
  ok(r.includes("família") && r.includes("fim de semana"), "tags aparecem na linha");
  ok(r.includes("Dividida em 2"), "divisão em 2 categorias aparece na linha");
  ok((await page.locator("tbody tr.sub", { hasText: "Lazer" }).count()) > 0, "a parte de Lazer aparece abaixo da transação");
  ok((await row(pizza).locator("[title='Comprovante']").count()) === 1, "comprovante anexado (clipe na linha)");
  const { data: note } = await s.db.from("transactions").select("notes").eq("id", px.id).single();
  ok(note?.notes === `aniversário ${RUN}`, "anotação salva");
  // soma das partes diferente do valor é recusada
  await row(pizza).getByRole("button", { name: /Detalhes/ }).click();
  await page.locator("dialog[open] input[placeholder='Valor']").nth(0).fill("10");
  await page.locator("dialog[open]").getByRole("button", { name: "Salvar" }).click();
  ok(await until(async () => (await page.locator("dialog[open] [role=alert]").innerText().catch(() => "")).includes("soma")), "divisão com soma errada é recusada com aviso");
  await page.locator("dialog[open]").getByRole("button", { name: "Cancelar" }).click();

  // ---------- contas: botão Pago / Em aberto
  await page.goto(BASE + "/contas");
  const dd = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(8, 10));
  const day = Math.min(28, dd + 2);
  // tocar num dia do calendário abre o painel com o formulário já com a data
  const cell = page.getByRole("button", { name: new RegExp(`^Dia ${day}:`) });
  ok(/sem contas/.test(await cell.getAttribute("aria-label")), "o dia ainda não tem conta no calendário");
  await cell.click();
  const f = page.locator("dialog[open] form");
  ok(await until(async () => (await f.count()) === 1), "tocar num dia abre o formulário de nova conta");
  ok(Number(await f.getByLabel("Vence dia").inputValue()) === day && (await f.getByLabel(/A partir de/).inputValue()).endsWith(`-${String(day).padStart(2, "0")}`), "o formulário já vem com o dia tocado");
  await f.getByLabel("Nome").fill(`Luz ${RUN}`); await f.getByLabel("Valor (R$)").fill("120");
  await f.getByRole("button", { name: "Salvar conta" }).click();
  await page.getByText(`Conta cadastrada para o dia ${day}.`).waitFor();
  ok(await until(async () => !(await page.locator("dialog[open]").count())), "ao salvar, o painel fecha");
  ok(await until(async () => { const l = (await cell.getAttribute("aria-label")) ?? ""; return l.includes(`Luz ${RUN}`) && l.includes("pendente"); }), "o dia ganha a marca da conta no calendário (pendente)");
  ok((await cell.locator(".cal-dot").count()) === 1, "com a bolinha de pendente");
  await page.reload();
  const bill = page.locator(".list", { hasText: `Luz ${RUN}` }).first();
  ok((await bill.innerText()).includes("Pendente"), "conta nova nasce pendente");
  await bill.getByRole("button", { name: "Pago", exact: true }).click();
  ok(await until(async () => (await bill.locator(".st").first().innerText()).includes("Pago")), "clicar em Pago → Pago");
  await bill.getByRole("button", { name: "Em aberto", exact: true }).click();
  ok(await until(async () => (await bill.locator(".st").first().innerText()).includes("Pendente")), "clicar em Em aberto → volta a Pendente");

  // ---------- orçamento, meta e aporte pelos formulários
  const edu0 = (await s.db.from("categories").select("id").eq("household_id", s.hid).eq("slug", "educacao").single()).data;
  eduHadBudget = !!(await s.db.from("budgets").select("id").eq("category_id", edu0.id).maybeSingle()).data;
  await page.goto(BASE + "/orcamentos");
  const bf = page.locator("form", { hasText: "Limite mensal" });
  await bf.getByLabel("Categoria").selectOption({ label: "Educação" });
  await bf.getByLabel("Limite mensal (R$)").fill("300");
  await bf.getByRole("button", { name: "Salvar limite" }).click();
  ok(await until(async () => (await main()).includes("Limite salvo.")), "formulário de orçamento salva o limite");
  const gf = page.locator("form", { hasText: "Criar meta" });
  await gf.getByLabel("Tipo").selectOption("saving");
  await gf.getByLabel("Nome").fill(`Viagem ${RUN}`);
  await gf.getByLabel("Valor (R$)").fill("1000");
  await gf.getByRole("button", { name: "Criar meta" }).click();
  ok(await until(async () => (await main()).includes(`Viagem ${RUN}`)), "formulário de meta cria a meta");
  const goal = page.locator(".card", { hasText: `Viagem ${RUN}` }).first();
  await goal.getByLabel("Valor do aporte").fill("250");
  await goal.getByRole("button", { name: "Guardar" }).click();
  ok(await until(async () => (await goal.innerText()).includes("R$ 250,00") && (await goal.innerText()).includes("25%")), "aporte de R$ 250 → 25% da meta");

  // ---------- widget da Pluggy abre com a CSP com nonce (sem bloqueio no console)
  await page.goto(BASE + "/conexoes");
  await page.getByRole("button", { name: "Conectar banco" }).first().click();
  const widget = await until(async () => page.frames().some((f) => f.url().includes("connect.pluggy.ai")), 20000);
  ok(widget, "o widget da Pluggy abre (iframe carregado)");
  ok(!errors.some((e) => /Content Security Policy|CSP/i.test(e)), "nenhum bloqueio de CSP no console");
} finally {
  // limpeza do que esta rodada criou
  await s.db.from("bills").delete().like("name", `%${RUN}%`).eq("household_id", s.hid);
  await (await adminDb()).from("transactions").delete().eq("household_id", s.hid).ilike("description", `%${RUN}%`);
  await s.db.from("goals").delete().like("name", `%${RUN}%`).eq("household_id", s.hid);
  const edu = (await s.db.from("categories").select("id").eq("household_id", s.hid).eq("slug", "educacao").single()).data;
  if (edu && !eduHadBudget) await s.db.from("budgets").delete().eq("category_id", edu.id); // só se foi o teste que criou
  ok(errors.length === 0, `console sem erros durante os cliques${errors.length ? ": " + errors.slice(0, 2).join(" | ") : ""}`);
  await b.close();
}
done("Interface");
