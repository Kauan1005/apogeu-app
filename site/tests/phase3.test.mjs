// Fase 3: patrimônio, relatório do IR em PDF, modo casal (convite de ponta a ponta) e backups.
import { inflateSync, gunzipSync } from "node:zlib";
import { readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { BASE, RUN, browser, done, http, login, ok, totp, until } from "./lib.mjs";
import { adminDb } from "./lib.mjs";

/** Digita o código do autenticador; se virar a janela de 30s no meio, tenta de novo com o código novo. */
async function enterTotp(p, secret) {
  for (let i = 0; i < 3; i++) {
    await p.getByLabel("Código").fill(totp(secret));
    if (await until(async () => new URL(p.url()).pathname === "/", 8000)) return true;
  }
  return false;
}

console.log(`\n== Fase 3 (${BASE}) · rodada ${RUN}`);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const s = await login();
const h = http(s);
const anon = http(null);
const sim = (b) => h.post("/api/dev/simulate-pix", b).then((r) => r.json.transaction);
const cats = Object.fromEntries((await s.db.from("categories").select("id, slug").eq("household_id", s.hid)).data.map((c) => [c.slug, c.id]));
const year = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 4));
const started = new Date().toISOString();
const MEMBER = `casal-${RUN}@fluxo.test`;

/** Texto de um PDF do pdf-lib: descomprime os streams e junta as strings de Tj. */
function pdfText(buf) {
  const raw = buf.toString("latin1");
  const parts = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m; (m = re.exec(raw)); ) {
    const bytes = Buffer.from(m[1], "latin1");
    let body; try { body = inflateSync(bytes).toString("latin1"); } catch { body = m[1]; }
    for (const t of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) parts.push(Buffer.from(t[1], "hex").toString("latin1"));
    for (const t of body.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) parts.push(t[1]);
  }
  return parts.join(" ");
}

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("dialog", (d) => d.accept());

try {
  // ------------------------------------------------------------ primeiro acesso
  const half = http(await login({ mfa: false }));
  const ds = await half.get("/definir-senha");
  ok(ds.status === 307 && (ds.loc ?? "").includes("/mfa"), "quem já tem 2FA não usa a tela de primeiro acesso para trocar a senha");
  ok((await anon.get("/auth/confirm?token_hash=abc&type=invite")).loc?.includes("/login?erro=link"), "link de convite inválido volta para o login");

  // ------------------------------------------------------------ patrimônio
  ok((await anon.get("/patrimonio")).status === 307, "patrimônio exige login");
  await page.goto(BASE + "/patrimonio");
  ok(await page.locator('svg[aria-label="Evolução do patrimônio líquido"]').count() === 1, "gráfico de evolução do patrimônio aparece");
  const snap0 = (await s.db.from("net_worth_snapshots").select("assets_cents, liabilities_cents").eq("household_id", s.hid).order("month", { ascending: false }).limit(1).single()).data;
  ok(!!snap0, "abrir a tela grava a foto do mês");
  const apto = `Apartamento ${RUN}`, fin = `Financiamento ${RUN}`;
  const add = async (tipo, nome, valor, pago, data) => {
    const f = page.locator("form").filter({ has: page.getByRole("button", { name: "Adicionar" }) });
    await f.getByLabel("Tipo").selectOption({ label: tipo });
    await f.getByLabel("Nome").fill(nome);
    await f.getByLabel("Valor atual (R$)").fill(String(valor));
    if (pago) { await f.getByLabel("Valor pago (R$, para o IR)").fill(String(pago)); await f.getByLabel("Data da compra").fill(data); }
    await f.getByRole("button", { name: "Adicionar" }).click();
    return until(async () => (await page.locator("main").innerText()).includes(nome));
  };
  ok(await add("Imóvel", apto, 350000, 280000, "2019-03-15"), "cadastrar um imóvel pela tela, com o valor pago e a data da compra");
  ok((await page.locator("main").innerText()).includes("pago R$ 280.000,00 em 03/2019"), "a lista mostra o custo de aquisição");
  const finForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Adicionar" }) });
  await finForm.getByLabel("Tipo").selectOption({ label: "Financiamento" });
  ok(await finForm.getByLabel("Valor pago (R$, para o IR)").count() === 0, "dívida não pede custo de aquisição");
  ok(await add("Financiamento", fin, 100000), "cadastrar um financiamento pela tela");
  const snap1 = (await s.db.from("net_worth_snapshots").select("assets_cents, liabilities_cents").eq("household_id", s.hid).order("month", { ascending: false }).limit(1).single()).data;
  ok(snap1.assets_cents - snap0.assets_cents === 35000000 && snap1.liabilities_cents - snap0.liabilities_cents === 10000000,
    "a foto do mês soma o imóvel nos bens e o financiamento nas dívidas");
  const { error: bad } = await s.db.from("holdings").insert({ household_id: s.hid, side: "asset", category: "financiamento", name: `x ${RUN}`, value_cents: 1 });
  ok(!!bad, "o banco recusa dívida marcada como bem");
  await page.getByRole("button", { name: `Editar ${apto}` }).click();
  const dlg = page.locator("dialog[open]");
  await dlg.getByLabel("Valor atual (R$)").fill("360000");
  await dlg.getByRole("button", { name: "Salvar" }).click();
  ok(await until(async () => (await page.locator("main").innerText()).includes("360.000,00")), "editar o valor do imóvel");
  await page.getByRole("button", { name: `Excluir ${fin}` }).click();
  ok(await until(async () => !(await page.locator("main").innerText()).includes(fin)), "excluir o financiamento (2FA recente)");

  // 7. carnê (conta fixa parcelada) entra nas dívidas como parcelas a vencer
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const liab0 = (await s.db.from("net_worth_snapshots").select("liabilities_cents").eq("household_id", s.hid).order("month", { ascending: false }).limit(1).single()).data.liabilities_cents;
  const { error: carneErr } = await s.db.from("bills").insert({ household_id: s.hid, name: `Carne Loja ${RUN}`, amount_cents: 10000, due_day: 28, starts_on: today.slice(0, 8) + "01", recurrence: "installments", installments_total: 5, match_keyword: null });
  await page.goto(BASE + "/patrimonio");
  const liab1 = (await s.db.from("net_worth_snapshots").select("liabilities_cents").eq("household_id", s.hid).order("month", { ascending: false }).limit(1).single()).data.liabilities_cents;
  ok(!carneErr && liab1 - liab0 === 50000 && await until(async () => (await page.locator("main").innerText()).includes("Parcelas a vencer")), "carnê de 5 × R$ 100 soma R$ 500 em “Parcelas a vencer” nas dívidas");

  // 9. histórico do valor de cada bem
  const { data: aptoRow } = await s.db.from("holdings").select("id").eq("household_id", s.hid).eq("name", apto).single();
  await admin.from("holding_values").upsert({ holding_id: aptoRow.id, household_id: s.hid, day: "2026-01-10", value_cents: 30000000 });
  await page.reload();
  ok(await until(async () => (await page.locator("main").innerText()).includes("antes R$ 300.000,00 (10/01/26)")), "a lista mostra o valor anterior do bem");
  await page.getByRole("button", { name: `Editar ${apto}` }).click();
  const hdlg = page.locator("dialog[open]");
  ok((await hdlg.innerText()).includes("Histórico de valores") && (await hdlg.innerText()).includes("10/01/2026"), "o histórico de valores aparece ao editar o bem");
  await hdlg.getByRole("button", { name: "Cancelar" }).click();

  // 6. patrimônio no painel e no Perguntar
  await page.goto(BASE + "/?detalhes=1");
  ok(await until(async () => (await page.locator("main").innerText()).includes("Patrimônio líquido")), "os detalhes do painel mostram o card de patrimônio líquido");
  const pq = (await h.get("/perguntar?q=" + encodeURIComponent("Qual é o meu patrimônio?"))).text;
  ok(pq.includes("Entendi: o seu patrimônio líquido hoje") && pq.includes("Investimentos"), "Perguntar responde “qual é o meu patrimônio?”");
  const dq = (await h.get("/perguntar?q=" + encodeURIComponent("quanto eu devo?"))).text;
  ok(dq.includes("Entendi: quanto você deve hoje") && dq.includes("Parcelas a vencer"), "Perguntar responde “quanto eu devo?”");

  // ------------------------------------------------------------ relatório do IR
  const CPF = String(Date.now()).slice(-11).padStart(11, "3");
  const CPFf = `${CPF.slice(0, 3)}.${CPF.slice(3, 6)}.${CPF.slice(6, 9)}-${CPF.slice(9)}`;
  const clin = `Clinica Sorriso ${RUN}`, emp = `Empresa Pagadora ${RUN}`;
  const tx1 = await sim({ name: clin, amount: 250, cpf: CPF });
  const tx2 = await sim({ name: emp, amount: 5000, direction: "in" });
  await s.db.from("transactions").update({ category_id: cats.saude, status: "ok" }).eq("id", tx1.id);
  await s.db.from("transactions").update({ category_id: cats.salario, status: "ok" }).eq("id", tx2.id);
  const farm = await sim({ name: `Drogaria Sao Paulo ${RUN}`, amount: 45 });
  const aluguel = await sim({ name: `Aluguel Inquilino ${RUN}`, amount: 1800, direction: "in", cpf: "52998224725" });
  const reemb = await sim({ name: `Reembolso Unimed ${RUN}`, amount: 120, direction: "in" });
  const prev = await sim({ name: `Brasilprev PGBL ${RUN}`, amount: 500 });
  await s.db.from("transactions").update({ category_id: cats.saude, status: "ok" }).eq("id", farm.id);
  await s.db.from("transactions").update({ category_id: cats["outras-entradas"], status: "ok" }).eq("id", aluguel.id);
  await s.db.from("transactions").update({ category_id: cats.reembolsos, status: "ok" }).eq("id", reemb.id);
  const { data: enc } = await s.db.from("transactions").select("counterpart_doc_enc").eq("id", tx1.id).single();
  ok(enc?.counterpart_doc_enc?.startsWith("v1.") && !enc.counterpart_doc_enc.includes(CPF), "CPF da contraparte guardado cifrado (AES-256-GCM), sem o número em claro");
  ok((await anon.get(`/api/relatorio/ir?ano=${year}`)).status === 401, "PDF do IR exige login");
  const r = await fetch(`${BASE}/api/relatorio/ir?ano=${year}`, { headers: { cookie: s.cookie() } });
  const pdf = Buffer.from(await r.arrayBuffer());
  ok(r.status === 200 && r.headers.get("content-type") === "application/pdf" && pdf.subarray(0, 4).toString() === "%PDF", "baixa o PDF do IR");
  const txt = pdfText(pdf);
  ok(txt.includes("Resumo para o Imposto de Renda") && txt.includes(`ano-calend\xe1rio ${year}`), "PDF tem o título e o ano");
  ok(txt.toLowerCase().includes(clin.toLowerCase()) && txt.includes(CPFf), "PDF lista a clínica com o CPF completo (dedutível)");
  ok(txt.toLowerCase().includes(emp.toLowerCase()), "PDF lista a fonte pagadora do salário");
  const low = txt.toLowerCase();
  const sec = (title, next) => low.slice(low.indexOf(title.toLowerCase()), next ? low.indexOf(next.toLowerCase(), low.indexOf(title.toLowerCase())) : undefined);
  ok(sec("Saúde que não é dedutível", "Gastos por categoria").includes(`drogaria sao paulo ${RUN}`.toLowerCase()) && !sec("Pagamentos que podem ser dedutíveis", "Reembolsos do plano").includes("drogaria"),
    "farmácia sai da saúde dedutível e vai para “não dedutível”");
  ok(sec("Recebidos de pessoas físicas", "Pagamentos que podem").includes(`aluguel inquilino ${RUN}`.toLowerCase()) && txt.includes("529.982.247-25"), "aluguel recebido de pessoa física aparece no carnê-leão, com o CPF");
  ok(sec("Reembolsos do plano", "Educação").includes(`reembolso unimed ${RUN}`.toLowerCase()) && txt.includes("Saúde dedutível já descontados os reembolsos"), "reembolso do plano abate da saúde dedutível");
  ok(sec("Previdência privada", "Pensão").includes(`brasilprev pgbl ${RUN}`.toLowerCase()), "contribuição de previdência (PGBL) aparece na seção própria");
  ok(txt.includes(apto) && txt.includes("360.000,00"), "PDF traz os bens cadastrados");
  ok(txt.includes("Custo (declarar)") && txt.includes("280.000,00") && txt.includes("15/03/2019"), "PDF declara o bem pelo custo de aquisição e a data da compra");
  const rel = (await h.get(`/relatorios?ano=${year}`)).text;
  ok(rel.toLowerCase().includes(clin.toLowerCase()) && !rel.includes(CPFf), "tela de relatórios mostra a clínica com o CPF mascarado");
  const { count: audited } = await admin.from("audit_log").select("id", { count: "exact", head: true }).eq("household_id", s.hid).eq("table_name", "relatorio_ir").gte("at", started);
  ok(audited >= 1, "o download do PDF fica na auditoria");

  // ------------------------------------------------------------ backups
  await page.goto(BASE + "/ajustes#backups");
  await page.getByRole("button", { name: "Fazer backup agora" }).click();
  ok(await until(async () => (await page.locator("main").innerText()).includes("Backup criado"), 30000), "fazer backup agora");
  await page.reload();
  const first = page.getByRole("button", { name: /Baixar backup .*-manual-/ }).first();
  ok(await first.count() === 1, "o backup aparece na lista");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), first.click()]);
  const bk = JSON.parse(gunzipSync(readFileSync(await dl.path())).toString());
  ok(bk.format === "fluxo-backup" && bk.household_id === s.hid && bk.data.transactions.some((t) => t.id === tx1.id) && bk.data.holdings.some((x) => x.name === apto),
    "o arquivo baixado tem as transações e o patrimônio da casa");
  ok(bk.version === 2 && bk.household?.id === s.hid && bk.data.household_members?.length >= 1 && Array.isArray(bk.files) && /^[0-9a-f]{12}$/.test(bk.key_fingerprint ?? ""),
    "o backup traz a casa, as pessoas, os comprovantes e a impressão digital da chave (não a chave)");
  ok(!JSON.stringify(bk).includes(process.env.DOC_ENC_KEY), "a chave DOC_ENC_KEY não vai dentro do backup");
  const { count: dlLogged } = await admin.from("audit_log").select("id", { count: "exact", head: true }).eq("household_id", s.hid).eq("table_name", "backup_download").gte("at", started);
  ok(dlLogged >= 1, "o download do backup fica registrado (base do lembrete mensal)");
  // restauração de verdade (conta de teste): o que entrou depois do backup some, o que estava no backup volta
  const bkFile = await dl.path();
  const marker = `Depois do backup ${RUN}`;
  await s.db.from("holdings").insert({ household_id: s.hid, side: "asset", category: "outro_bem", name: marker, value_cents: 100 });
  await s.db.from("holdings").update({ value_cents: 1 }).eq("household_id", s.hid).eq("name", apto);
  const before = new Set(existsSync("backups-locais") ? readdirSync("backups-locais") : []);
  execFileSync(process.execPath, ["--env-file=.env.local", "scripts/restore-backup.mjs", bkFile, "--yes"], { stdio: "pipe" });
  const { data: afterH } = await s.db.from("holdings").select("name, value_cents").eq("household_id", s.hid);
  ok(!afterH.some((x) => x.name === marker) && afterH.find((x) => x.name === apto)?.value_cents === 36000000, "restaurar o backup volta os dados ao estado do backup");
  ok((await s.db.from("transactions").select("id").eq("id", tx1.id).maybeSingle()).data?.id === tx1.id, "as transações voltam com a restauração");
  ok((await h.get("/patrimonio")).status === 200, "o login continua funcionando depois da restauração");
  const created = (existsSync("backups-locais") ? readdirSync("backups-locais") : []).filter((f) => !before.has(f));
  ok(created.length === 1, "antes de restaurar, o estado atual é salvo numa cópia local");
  for (const f of created) rmSync(`backups-locais/${f}`);
  const again = await page.getByRole("button", { name: "Fazer backup agora" }).click().then(() => until(async () => (await page.locator("main").innerText()).includes("menos de 10 minutos"), 15000));
  ok(again, "não deixa gerar backups em sequência (10 minutos)");
  const { error: upErr } = await s.db.storage.from("backups").upload(`${s.hid}/falso-${RUN}.json.gz`, Buffer.from("x"), { contentType: "application/gzip" });
  ok(!!upErr, "usuário não consegue gravar no cofre de backups (só o servidor)");

  // ------------------------------------------------------------ 10. tarefas diárias separadas
  ok((await fetch(BASE + "/api/cron/manutencao")).status === 403, "manutenção diária recusa chamada sem segredo");
  const man = await fetch(BASE + "/api/cron/manutencao", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  const manJ = await man.json().catch(() => ({}));
  ok(man.status === 200 && manJ.ok && manJ.snapshots >= 1 && Array.isArray(manJ.backups), "manutenção diária grava o patrimônio, cuida do backup e da lixeira");

  // ------------------------------------------------------------ modo casal: convite de ponta a ponta
  await page.goto(BASE + "/ajustes#pessoas");
  await page.getByLabel("E-mail da pessoa").fill(MEMBER);
  await page.getByRole("button", { name: "Gerar convite" }).click();
  const linkBox = page.getByLabel("Link de convite");
  ok(await until(async () => (await linkBox.count()) > 0, 15000), "o dono gera o link de convite");
  const link = await linkBox.inputValue();
  ok(link.startsWith(BASE + "/auth/confirm?token_hash="), "o link aponta para o próprio site");
  const guest = await b.newContext({ viewport: { width: 390, height: 844 } });
  const gp = await guest.newPage();
  gp.on("pageerror", (e) => errors.push("convidado: " + e.message));
  await gp.goto(link);
  ok(gp.url().endsWith("/definir-senha") && (await gp.locator("h1").innerText()) === "Crie a sua senha", "o convidado abre o link e cai em “Crie a sua senha”");
  const pw = `Tt${Math.random().toString(36).slice(2)}!${Date.now()}`;
  await gp.getByLabel("Nova senha").fill(pw);
  await gp.getByLabel("Repita a senha").fill(pw);
  await gp.getByRole("button", { name: "Salvar e continuar" }).click();
  ok(await until(async () => gp.url().includes("/mfa") && (await gp.locator(".mono").count()) > 0, 15000), "depois da senha vem o cadastro do 2FA");
  ok((await (await guest.request.get(BASE + "/transacoes", { maxRedirects: 0 })).status()) === 307, "sem 2FA o convidado não vê nada");
  const secret = (await gp.locator("span.mono").innerText()).trim();
  ok(await enterTotp(gp, secret), "o convidado ativa o 2FA e entra no painel");
  await gp.goto(BASE + "/transacoes?periodo=1");
  ok(await until(async () => (await gp.locator("main").innerText()).toLowerCase().includes(clin.toLowerCase()), 10000), "o convidado vê as mesmas transações da casa (modo casal)");
  await gp.goto(BASE + "/ajustes#pessoas");
  ok((await gp.locator("main").innerText()).includes("Só o dono da conta pode convidar"), "convidado não pode convidar ninguém");
  const { data: mem } = await admin.from("household_members").select("role").eq("household_id", s.hid).neq("user_id", (await s.db.auth.getUser()).data.user.id);
  ok(mem?.length === 1 && mem[0].role === "member", "o convidado entra como membro (não dono)");
  const { data: inviteRow } = await admin.from("household_invites").select("accepted_at").eq("household_id", s.hid).eq("email", MEMBER).single();
  ok(!!inviteRow?.accepted_at, "o convite fica marcado como aceito");
  const reuse = await fetch(link, { redirect: "manual" });
  ok((reuse.headers.get("location") ?? "").includes("/login?erro=link"), "o link não funciona uma segunda vez");

  // bancos por pessoa: cada conexão sabe quem conectou
  const ownerId = (await s.db.auth.getUser()).data.user.id;
  const memberId = (await admin.auth.admin.listUsers({ perPage: 200 })).data.users.find((u) => u.email === MEMBER).id;
  const fakeItem = (n) => `00000000-0000-4${n}00-8000-${String(Date.now()).slice(-12)}`;
  const { data: cOwner } = await admin.from("connections").insert({ household_id: s.hid, provider_item_id: fakeItem(1), institution: `Banco do Dono ${RUN}`, status: "UPDATED", created_by: ownerId }).select("id").single();
  const { data: cMem } = await admin.from("connections").insert({ household_id: s.hid, provider_item_id: fakeItem(2), institution: `Banco do Convidado ${RUN}`, status: "UPDATED", created_by: memberId }).select("id").single();
  const { data: accMem } = await admin.from("accounts").insert({ household_id: s.hid, connection_id: cMem.id, provider_account_id: `acc-${RUN}`, name: `Conta Convidado ${RUN}`, type: "checking", institution: "Teste" }).select("id").single();
  await admin.from("transactions").insert({ household_id: s.hid, account_id: accMem.id, provider_tx_id: `tx-${RUN}`, occurred_at: new Date().toISOString(), amount_cents: -1234, description_raw: `Gasto convidado ${RUN}`, description: `Gasto convidado ${RUN}` });
  await gp.goto(BASE + "/conexoes");
  await gp.waitForLoadState("networkidle");
  await until(async () => (await gp.locator("main").innerText()).includes(`Banco do Dono ${RUN}`));
  const gText = await gp.locator("main").innerText();
  ok(gText.includes(`Banco do Dono ${RUN}`) && gText.includes("conectado por"), "Conexões mostra quem conectou cada banco");
  const ownerCard = gp.locator(".card", { hasText: `Banco do Dono ${RUN}` });
  const memCard = gp.locator(".card", { hasText: `Banco do Convidado ${RUN}` });
  ok(await ownerCard.getByRole("button", { name: "Desconectar" }).count() === 0 && await memCard.getByRole("button", { name: "Desconectar" }).count() === 1,
    "o convidado só vê “Desconectar” nos bancos que ele conectou");
  // pelo banco (RLS), o convidado não apaga a conexão do dono
  const gjar = new Map((await guest.cookies()).map((c) => [c.name, c.value]));
  const gdb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => [...gjar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => gjar.set(name, value)) },
  });
  await gdb.from("connections").delete().eq("id", cOwner.id);
  ok(!!(await admin.from("connections").select("id").eq("id", cOwner.id).maybeSingle()).data, "o banco (RLS) impede o convidado de apagar a conexão do dono");

  // 11. de quem é cada conta: filtro “Pessoa” em Transações
  await page.goto(BASE + "/transacoes");
  const pessoa = page.getByLabel("Pessoa");
  ok(await pessoa.count() === 1, "Transações ganha o filtro “Pessoa” quando a casa tem mais de uma");
  await pessoa.selectOption({ label: MEMBER });
  ok(await until(async () => { const t = await page.locator("tbody").innerText(); return t.includes(`Gasto convidado ${RUN}`) && !t.toLowerCase().includes(clin.toLowerCase()); }, 8000),
    "filtrar pela pessoa mostra só os gastos dos bancos dela");

  // recuperação do 2FA: script do computador e botão do dono
  execFileSync(process.execPath, ["--env-file=.env.local", "scripts/reset-mfa.mjs", MEMBER], { stdio: "pipe" });
  ok(((await admin.auth.admin.mfa.listFactors({ userId: memberId })).data?.factors ?? []).length === 0, "script reset-mfa apaga o autenticador perdido");
  const g2 = await b.newContext({ viewport: { width: 390, height: 844 } });
  const gp2 = await g2.newPage();
  await gp2.goto(BASE + "/login");
  await gp2.getByLabel("E-mail").fill(MEMBER);
  await gp2.getByLabel("Senha", { exact: true }).fill(pw);
  await gp2.getByRole("button", { name: "Entrar" }).click();
  ok(await until(async () => gp2.url().includes("/mfa") && (await gp2.locator("span.mono").count()) > 0, 15000), "depois do reset, o login pede para cadastrar um novo autenticador");
  ok(await enterTotp(gp2, (await gp2.locator("span.mono").innerText()).trim()), "com o novo celular, a pessoa entra de novo");
  await g2.close();
  await page.goto(BASE + "/ajustes#pessoas");
  await page.reload(); // mesma URL com âncora não recarrega sozinha
  await page.getByRole("button", { name: "Redefinir 2FA" }).click();
  ok(await until(async () => ((await admin.auth.admin.mfa.listFactors({ userId: memberId })).data?.factors ?? []).length === 0, 15000), "o dono redefine o 2FA do convidado pela tela");
  ok(await until(async () => (await page.locator("main").innerText()).includes("aguardando o primeiro acesso"), 10000), "a pessoa volta a “aguardando o primeiro acesso”");

  // dono remove o acesso e apaga o histórico dos bancos dela
  await page.goto(BASE + "/ajustes#pessoas");
  await page.getByRole("button", { name: `Remover acesso de ${MEMBER}` }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Remover e apagar o histórico dos bancos dela" }).click();
  ok(await until(async () => !(await page.locator("#pessoas").innerText()).includes(MEMBER), 15000), "o dono remove o acesso do convidado");
  await gp.goto(BASE + "/transacoes");
  ok(!(await gp.locator("main").innerText().catch(() => "")).toLowerCase().includes(clin.toLowerCase()), "depois de removido, o convidado perde o acesso na hora");
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  ok(!users.users.some((u) => u.email === MEMBER), "o login do convidado é apagado");
  ok(!(await admin.from("connections").select("id").eq("id", cMem.id).maybeSingle()).data && !(await admin.from("accounts").select("id").eq("id", accMem.id).maybeSingle()).data,
    "os bancos que o convidado conectou saem junto, com o histórico deles");
  ok(!!(await admin.from("connections").select("id").eq("id", cOwner.id).maybeSingle()).data, "os bancos do dono continuam");
  await page.goto(BASE + "/ajustes#atividade");
  const atv = await page.locator("#atividade").textContent(); // inclui os itens dentro de "Ver todos"
  ok(atv.includes("Você") && atv.includes(`apagou o bem ou dívida “${fin}”`) && atv.includes("redefiniu um 2FA"), "Atividade recente mostra quem fez cada alteração");
  await guest.close();

  ok(!errors.length, `console sem erros${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
} finally {
  // limpeza desta rodada
  await s.db.from("holdings").delete().eq("household_id", s.hid).ilike("name", `%${RUN}%`);
  await s.db.from("bills").delete().eq("household_id", s.hid).ilike("name", `%${RUN}%`);
  await (await adminDb()).from("transactions").delete().eq("household_id", s.hid).ilike("description", `%${RUN}%`);
  const { data: files } = await admin.storage.from("backups").list(s.hid, { limit: 100 });
  const mine = (files ?? []).filter((f) => (f.created_at ?? "") >= started).map((f) => `${s.hid}/${f.name}`);
  if (mine.length) await admin.storage.from("backups").remove(mine);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of users.users.filter((x) => x.email === MEMBER)) { await admin.from("household_members").delete().eq("user_id", u.id); await admin.auth.admin.deleteUser(u.id); }
  await admin.from("household_invites").delete().eq("email", MEMBER);
  await admin.from("connections").delete().eq("household_id", s.hid).ilike("institution", `%${RUN}%`);
  await admin.from("accounts").delete().eq("household_id", s.hid).ilike("name", `%${RUN}%`);
  await b.close();
}
done("Fase 3");
