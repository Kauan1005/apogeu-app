// Importar extrato (OFX e CSV): leitores, tela, idempotência, cartão com sinais invertidos, saldo e registro de atividade.
import { BASE, RUN, adminDb, browser, done, login, ok, until } from "./lib.mjs";
import { decodeStatement, looksInverted, numberDuplicates, parseAmount, parseDate, parseStatement } from "../src/lib/statement-import.ts";

console.log(`\n== Importar extrato (${BASE}) · rodada ${RUN}`);

// ------------------------------------------------------------ leitores (sem navegador)
ok(parseAmount("1.234,56") === 123456 && parseAmount("-1234.56") === -123456 && parseAmount("R$ 1.234,56") === 123456 && parseAmount("(123,45)") === -12345 && parseAmount("123,45-") === -12345 && parseAmount("1.234") === 123400 && parseAmount("12.34") === 1234 && parseAmount("abc") === null, "valores: vírgula, ponto, R$, parênteses e sinal no fim");
ok(parseDate("05/11/2026") === "2026-11-05" && parseDate("5-11-26") === "2026-11-05" && parseDate("2026-11-05T10:00:00") === "2026-11-05" && parseDate("20261105120000[-3:BRT]") === "2026-11-05" && parseDate("31/02/2026") === null, "datas: dd/mm/aaaa, aaaa-mm-dd, OFX; recusa dia inexistente");

const ofx = (org) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>${org}</ORG></FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105120000[-3:BRT]<TRNAMT>-45,90<FITID>F1${RUN}<NAME>UBER *TRIP<MEMO>UBER *TRIP</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261106<TRNAMT>-120.00<FITID>F2${RUN}<NAME>PADARIA PAO DOCE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261107<TRNAMT>5000.00<FITID>F3${RUN}<NAME>SALARIO EMPRESA X<MEMO>Credito de salario</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261107<TRNAMT>-45.90<FITID>F4${RUN}<NAME>UBER *TRIP</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1234.56<DTASOF>20261120</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const o = parseStatement(ofx(`Banco Teste ${RUN}`));
ok(o.format === "ofx" && o.kind === "bank" && o.rows.length === 4 && o.balanceCents === 123456 && o.org === `Banco Teste ${RUN}`, "OFX de conta: 4 lançamentos, saldo e nome do banco");
ok(o.rows[0].cents === -4590 && o.rows[0].date === "2026-11-05" && o.rows[0].id === `F1${RUN}` && o.rows[0].desc === "UBER *TRIP" && o.rows[2].desc === "SALARIO EMPRESA X Credito de salario", "OFX: valor com vírgula, data, FITID e texto sem repetir NAME e MEMO");
ok(parseStatement(ofx("X").replace("<BANKMSGSRSV1>", "<CREDITCARDMSGSRSV1>")).kind === "credit", "OFX de cartão é reconhecido");

const nubank = `date,category,title,amount
2026-11-03,restaurante,Padaria Sol,32.50
2026-11-04,transporte,Uber *Trip,18.90
2026-11-04,transporte,Uber *Trip,18.90
2026-11-05,serviços,Netflix,55.90
2026-11-06,compras,Loja Azul Parc 02/05,100.00
`;
const n = parseStatement(nubank);
ok(n.format === "csv" && n.rows.length === 5 && n.rows.every((r) => r.cents > 0) && looksInverted(n.rows, "credit") && !looksInverted(n.rows, "bank"), "CSV de cartão (compras positivas): 5 linhas e sugere inverter só para cartão");
const num = numberDuplicates(n.rows);
ok(num[1].occ === 0 && num[2].occ === 1 && num[0].occ === 0, "duas compras iguais no mesmo dia ficam distintas (numeradas)");

const inter = `Extrato Conta Corrente
Conta;123456

Data Lançamento;Histórico;Descrição;Valor;Saldo
05/11/2026;Pix enviado;Maria Silva;-1.234,56;5.000,00
06/11/2026;Pix recebido;João;2.000,00;7.000,00
07/11/2026;SALDO DO DIA;;;7.000,00
`;
const i = parseStatement(inter);
ok(i.rows.length === 2 && i.rows[0].cents === -123456 && i.rows[0].desc === "Pix enviado Maria Silva" && i.rows[1].cents === 200000, "CSV com ';', texto antes do cabeçalho, milhar com ponto e linha de saldo ignorada");
const dc = parseStatement("Data;Descrição;Débito;Crédito\n05/11/2026;Mercado;120,00;\n06/11/2026;Depósito;;300,00\n");
ok(dc.rows.length === 2 && dc.rows[0].cents === -12000 && dc.rows[1].cents === 30000, "CSV com colunas de débito e crédito separadas");
const latin = decodeStatement(new Uint8Array(Buffer.from("Data;Descrição;Valor\n05/11/2026;Café São João;-10,00", "latin1")).buffer);
ok(parseStatement(latin).rows[0].desc === "Café São João", "arquivo em Windows-1252 (acentos) é lido certo");
let bad = "";
try { parseStatement("a,b,c\n1,2,3"); } catch (e) { bad = e.message; }
ok(/colunas de data/.test(bad), "arquivo que não é extrato dá erro claro");

// ------------------------------------------------------------ tela e banco
const admin = await adminDb();
const s = await login();
const br = await browser();
const names = [`Banco Teste ${RUN}`, `Cartao Teste ${RUN}`];
try {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const p = await ctx.newPage();
  await p.goto(BASE + "/conexoes");
  await p.waitForLoadState("networkidle");
  const card = p.locator(".stmt");
  const file = card.locator('input[type="file"]');
  const result = card.getByTestId("stmt-result");
  const importar = (nLinhas) => card.getByRole("button", { name: new RegExp(`Importar ${nLinhas} lançamentos`) });

  await file.setInputFiles({ name: "extrato.ofx", mimeType: "application/x-ofx", buffer: Buffer.from(ofx(names[0])) });
  ok(await until(async () => (await card.getByTestId("stmt-summary").count()) === 1), "escolher o OFX mostra o resumo antes de importar");
  const sum = (await card.getByTestId("stmt-summary").innerText()).replace(/ /g, " ");
  ok(sum.includes("4 lançamentos") && sum.includes("05/11/2026") && sum.includes("07/11/2026"), "com a quantidade e o período");
  ok((await card.innerText()).includes("Entradas R$ 5.000,00") && (await card.innerText()).includes("Saídas R$ 211,80"), "e os totais de entradas e saídas");
  ok((await card.getByLabel("Nome da conta").inputValue()) === names[0] && (await card.getByLabel(/Saldo atual/).inputValue()) === "1234,56", "o nome do banco e o saldo vêm do arquivo");
  await importar(4).click();
  ok(await until(async () => (await result.count()) === 1 && (await result.innerText()).includes("4 novos"), 30000), "importar grava os 4 lançamentos");

  const acc = (await admin.from("accounts").select("id, type, institution, balance_cents").eq("household_id", s.hid).eq("name", names[0]).single()).data;
  ok(acc?.type === "checking" && acc.institution === "Importado" && Number(acc.balance_cents) === 123456, "cria a conta (Importado) com o saldo informado");
  const tx = (await admin.from("transactions").select("provider_tx_id, amount_cents, category_id, status").eq("account_id", acc.id)).data ?? [];
  ok(tx.length === 4 && tx.some((t) => t.provider_tx_id === `ofx-F4${RUN}`) && tx.some((t) => Number(t.amount_cents) === 500000) && tx.filter((t) => Number(t.amount_cents) === -4590).length === 2, "os lançamentos ficam com valor e identificador do banco (duas compras iguais, dois lançamentos)");
  ok(tx.every((t) => t.category_id) , "passam pela categorização (todos com categoria ou na fila de revisão)");

  // importar o mesmo arquivo de novo não duplica
  await file.setInputFiles({ name: "extrato.ofx", mimeType: "application/x-ofx", buffer: Buffer.from(ofx(names[0])) });
  await importar(4).click();
  ok(await until(async () => (await result.innerText()).includes("0 novos, 4 já existiam"), 30000), "importar de novo o mesmo arquivo não duplica (0 novos, 4 já existiam)");
  ok(((await admin.from("transactions").select("id").eq("account_id", acc.id)).data ?? []).length === 4, "e o banco continua com 4 lançamentos");

  // CSV de cartão: compras positivas → sugere inverter; parcela reconhecida
  await file.setInputFiles({ name: "nubank.csv", mimeType: "text/csv", buffer: Buffer.from(nubank) });
  await card.getByLabel("Tipo").selectOption("credit");
  ok(await card.getByRole("checkbox").isChecked(), "no cartão com compras positivas, “Inverter entradas e saídas” já vem marcado");
  await card.getByLabel("Nome da conta").fill(names[1]);
  await importar(5).click();
  ok(await until(async () => (await result.innerText()).includes("5 novos"), 30000), "o CSV do cartão importa os 5 lançamentos");
  const cc = (await admin.from("accounts").select("id, type").eq("household_id", s.hid).eq("name", names[1]).single()).data;
  const ctxs = (await admin.from("transactions").select("amount_cents, description, installment_number, total_installments").eq("account_id", cc.id)).data ?? [];
  ok(cc.type === "credit" && ctxs.length === 5 && ctxs.every((t) => Number(t.amount_cents) < 0), "o cartão vira conta de crédito e as compras entram como saídas");
  ok(ctxs.filter((t) => Number(t.amount_cents) === -1890).length === 2, "as duas compras iguais do mesmo dia entram as duas");
  ok(ctxs.some((t) => t.installment_number === 2 && t.total_installments === 5), "“Parc 02/05” vira parcela 2 de 5");
  ok(ctxs.some((t) => t.description === "Loja Azul Parc 02/05"), "o texto fica como veio (só ajusta o que vem todo em maiúsculas)");
  ok(((await admin.from("audit_log").select("id").eq("household_id", s.hid).eq("table_name", "extrato_importado")).data ?? []).length >= 3, "cada importação fica no histórico de atividade");

  // arquivo inválido
  await file.setInputFiles({ name: "nada.csv", mimeType: "text/csv", buffer: Buffer.from("a,b,c\n1,2,3") });
  ok(await until(async () => (await card.innerText()).includes("Não achei as colunas")), "arquivo que não é extrato mostra o motivo e nada é importado");
  await ctx.close();
} finally {
  await br.close();
  for (const nm of names) {
    const a = (await admin.from("accounts").select("id").eq("household_id", s.hid).eq("name", nm).maybeSingle()).data;
    if (a) { await admin.from("transactions").delete().eq("account_id", a.id); await admin.from("accounts").delete().eq("id", a.id); }
  }
}
done("Importar extrato");
