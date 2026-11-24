import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { brl } from "./format";
import { HOLDING_CATS, type HoldingCat } from "./patrimonio";
import type { IrReport, Party } from "./ir";

// PDF em A4 com fonte padrão (Helvetica, WinAnsi): acentos do português funcionam; o resto é limpo.
const clean = (s: string) =>
  s.replace(/[−–—]/g, "-").replace(/›/g, ">").replace(/[  ]/g, " ").replace(/[^\x20-\x7E\xA0-\xFF•…]/g, "");
const money = (c: number) => clean(brl(c));

export async function irPdf(r: IrReport, generatedAt: Date) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Apogeu - Resumo para o IR ${r.year}`); doc.setProducer("Apogeu"); doc.setCreator("Apogeu");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 48;
  const ink = rgb(0.1, 0.1, 0.1), muted = rgb(0.42, 0.42, 0.42), line = rgb(0.85, 0.85, 0.85);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const ensure = (h: number) => { if (y - h < M + 20) { page = doc.addPage([W, H]); y = H - M; } };
  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = ink) => page.drawText(clean(s), { x, y, size, font: f, color });
  const right = (s: string, xr: number, size = 10, f: PDFFont = font, color = ink) => { const t = clean(s); page.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y, size, font: f, color }); };
  const fit = (s: string, max: number, size = 10, f: PDFFont = font) => { let t = clean(s); while (t.length > 1 && f.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2) + "…"; return t; };
  const wrap = (s: string, size: number, max: number, color = muted) => {
    const words = clean(s).split(" "); let cur = "";
    for (const w of words) {
      if (font.widthOfTextAtSize(cur + " " + w, size) > max && cur) { ensure(size + 4); text(cur, M, size, font, color); y -= size + 4; cur = w; }
      else cur = cur ? cur + " " + w : w;
    }
    if (cur) { ensure(size + 4); text(cur, M, size, font, color); y -= size + 4; }
  };
  const h2 = (s: string) => { ensure(96); // título nunca fica sozinho no fim da página
    y -= 14; text(s, M, 13, bold); y -= 8; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line }); y -= 16; };
  const h3 = (s: string) => { ensure(32); y -= 4; text(s, M, 10.5, bold); y -= 15; };
  type Col = { t: string; x?: number; r?: number; w?: number; f?: PDFFont; c?: ReturnType<typeof rgb> };
  const row = (cols: Col[], size = 9.5) => {
    ensure(size + 6);
    for (const c of cols) {
      if (c.r != null) right(c.t, c.r, size, c.f ?? font, c.c ?? ink);
      else text(c.w ? fit(c.t, c.w, size, c.f ?? font) : c.t, c.x ?? M, size, c.f ?? font, c.c ?? ink);
    }
    y -= size + 6;
  };
  const none = (s: string) => row([{ t: s, c: muted }]);
  const parties = (ps: Party[], emptyMsg: string) => {
    if (!ps.length) return none(emptyMsg);
    row([{ t: "Nome", c: muted }, { t: "CPF/CNPJ", x: 320, c: muted }, { t: "Valor", r: W - M, c: muted }], 8.5);
    for (const p of ps.slice(0, 40)) row([{ t: p.name, w: 260 }, { t: p.doc ?? "-", x: 320, c: muted }, { t: money(p.cents), r: W - M }]);
    if (ps.length > 40) none(`+ ${ps.length - 40} outros`);
    row([{ t: "Total", f: bold }, { t: money(ps.reduce((s, p) => s + p.cents, 0)), r: W - M, f: bold }]);
  };

  // cabeçalho
  text("apogeu", M, 11, bold, muted); y -= 26;
  text(`Resumo para o Imposto de Renda · ano-calendário ${r.year}`, M, 17, bold); y -= 18;
  text(`Gerado em ${generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · ${r.txCount} transações no ano`, M, 9, font, muted); y -= 16;
  wrap("Este resumo organiza o que passou pelas contas conectadas e o que foi cadastrado à mão. Ele ajuda a preencher a declaração, mas não substitui os informes de rendimentos dos bancos, empregadores e corretoras: confira cada valor com eles antes de declarar.", 8.5, W - 2 * M);

  h2("Resumo do ano");
  row([{ t: "Entradas (sem transferências entre contas)" }, { t: money(r.totalIn), r: W - M }]);
  row([{ t: "Gastos (sem transferências e pagamento de fatura)" }, { t: money(r.totalOut), r: W - M }]);

  h2("Bens e direitos");
  h3("Saldos em conta");
  if (!r.balances.length) none("Nenhuma conta corrente ou poupança conectada.");
  else {
    row([{ t: "Conta", c: muted }, { t: `31/12/${r.year - 1}`, r: W - M - 110, c: muted }, { t: `31/12/${r.year}`, r: W - M, c: muted }], 8.5);
    for (const b of r.balances) row([{ t: `${b.institution} · ${b.name}${b.number ? " " + b.number : ""}`, w: 300 }, { t: money(b.prev), r: W - M - 110 }, { t: money(b.end), r: W - M }]);
    if (!r.coverageOk) wrap(`Saldos calculados a partir do saldo de hoje, desfazendo as transações. O histórico importado não cobre todo o período desde 31/12/${r.year - 1}, então use o informe do banco para essa data.`, 8, W - 2 * M);
  }
  h3("Outros bens");
  wrap("Na declaração, bens entram pelo custo de aquisição (o que foi pago), não pelo valor de mercado. O valor atual aparece só como referência.", 8, W - 2 * M);
  if (!r.assets.length) none("Nenhum bem cadastrado.");
  else row([{ t: "Bem", c: muted }, { t: "Compra", x: 290, c: muted }, { t: "Custo (declarar)", r: W - M - 110, c: muted }, { t: "Valor atual", r: W - M, c: muted }], 8.5);
  for (const a of r.assets) {
    const acq = a.acquisition_cents != null ? Number(a.acquisition_cents) : null;
    row([
      { t: `${a.name} \u00B7 ${HOLDING_CATS[a.category as HoldingCat]?.label ?? a.category}`, w: 230 },
      { t: a.acquired_on ? a.acquired_on.split("-").reverse().join("/") : "-", x: 290, c: muted },
      acq != null ? { t: money(acq), r: W - M - 110 } : { t: "informe o valor pago", r: W - M - 110, c: muted },
      { t: money(a.value_cents), r: W - M, c: muted },
    ]);
  }

  h2("Dívidas e ônus reais (valor atual)");
  if (!r.debts.length) none("Nenhuma dívida cadastrada ou importada.");
  for (const d of r.debts) row([{ t: d.name, w: 260 }, { t: HOLDING_CATS[d.category as HoldingCat]?.label ?? d.category, x: 320, c: muted }, { t: money(d.value_cents), r: W - M }]);

  h2("Rendimentos recebidos");
  h3("Salário · por fonte pagadora"); parties(r.income.salario, "Nenhuma entrada na categoria Salário.");
  h3("Rendimentos de aplicações"); parties(r.income.rendimentos, "Nenhuma entrada na categoria Rendimentos.");
  h3("Outras entradas e reembolsos"); parties(r.income.outras, "Nenhuma.");
  h3("Recebidos de pessoas físicas (podem exigir carnê-leão)");
  if (r.carneLeao.parties.length) {
    wrap("Aluguel, serviços e outros valores recebidos de pessoas físicas são tributáveis e, acima do limite de isenção do mês, pedem o carnê-leão. Transferências entre pessoas da família e devoluções não contam: confira cada um.", 8, W - 2 * M);
    parties(r.carneLeao.parties, "");
    row([{ t: "Por mês", c: muted }], 8.5);
    for (const m of r.carneLeao.months) row([{ t: m.ym.split("-").reverse().join("/") }, { t: money(m.cents), r: W - M }]);
  } else none("Nenhum recebimento de pessoa física identificado.");

  h2("Pagamentos que podem ser dedutíveis");
  wrap("Saúde (médicos, dentistas, psicólogos, planos, exames) e educação (escola, faculdade) entram na declaração com o CPF/CNPJ de quem recebeu. Remédios e cursos livres não são dedutíveis.", 8, W - 2 * M);
  y -= 4;
  h3("Saúde"); parties(r.deductible.saude, "Nenhum gasto dedutível na categoria Saúde.");
  if (r.deductible.reembolsos.length) {
    h3("Reembolsos do plano de saúde (abatem da despesa médica)"); parties(r.deductible.reembolsos, "");
    const net = r.deductible.saude.reduce((s, p) => s + p.cents, 0) - r.deductible.reembolsos.reduce((s, p) => s + p.cents, 0);
    row([{ t: "Saúde dedutível já descontados os reembolsos", f: bold }, { t: money(Math.max(0, net)), r: W - M, f: bold }]);
  }
  h3("Educação"); parties(r.deductible.educacao, "Nenhum gasto na categoria Educação.");
  h3("Previdência privada");
  if (r.deductible.previdencia.length) { wrap("PGBL é dedutível até 12% da renda tributável; VGBL não é dedutível (vai em Bens e direitos).", 8, W - 2 * M); parties(r.deductible.previdencia, ""); }
  else none("Nenhuma contribuição identificada.");
  h3("Pensão alimentícia paga"); parties(r.deductible.pensao, "Nenhum pagamento identificado.");
  h3("Saúde que não é dedutível (farmácia)"); parties(r.naoDedutivel.farmacia, "Nenhum gasto em farmácia.");

  h2("Gastos por categoria");
  if (!r.expenses.length) none("Nenhum gasto no ano.");
  for (const e of r.expenses) row([{ t: e.name, w: 300 }, { t: money(e.cents), r: W - M }]);

  // rodapé com numeração
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const t = `Apogeu · IR ${r.year} · página ${i + 1} de ${pages.length}`;
    p.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 8), y: 24, size: 8, font, color: muted });
  });
  return doc.save();
}
