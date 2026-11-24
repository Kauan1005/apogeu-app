/**
 * Leitura de extratos exportados pelo banco (OFX e CSV), no navegador: o arquivo nunca sai do aparelho cru,
 * só as linhas já entendidas vão ao servidor. Sem dependências; funciona também no Node (testes).
 */
export type StmtRow = { date: string; desc: string; cents: number; id?: string };
export type StmtParsed = {
  rows: StmtRow[];
  /** O que o arquivo diz ser (OFX): conta ou cartão. CSV não diz. */
  kind: "bank" | "credit" | null;
  balanceCents: number | null;
  org: string | null;
  format: "ofx" | "csv";
  /** Linhas ignoradas por não terem data ou valor legíveis. */
  skipped: number;
};

/** Texto do arquivo: UTF-8; se não for, Windows-1252 (como os bancos costumam exportar). */
export function decodeStatement(buf: ArrayBuffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); }
  catch { return new TextDecoder("windows-1252").decode(buf); }
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** "1.234,56", "-1234.56", "R$ 1.234,56", "(123,45)", "123,45-" → centavos (inteiro) ou null. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/[Rr]\$|\s| /g, "").replace(/[−–]/g, "-");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // o último separador é o decimal
    const dec = lastDot > lastComma ? "." : ",";
    s = dec === "." ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    // só pontos: "1.234" (milhar) ou "12.34" (decimal)
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return neg ? -cents : cents;
}

const iso = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** "dd/mm/aaaa", "dd/mm/aa", "dd-mm-aaaa", "dd.mm.aaaa", "aaaa-mm-dd", "aaaammdd" → "aaaa-mm-dd" ou null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m && /^\d{8}/.test(s)) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return iso(y, +m[2], +m[1]);
  }
  return null;
}

// ------------------------------------------------------------------ OFX
const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : null;
};
const unEntity = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export function parseOFX(text: string): StmtParsed {
  const kind = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(text) ? "credit" : /<BANKMSGSRSV1>|<STMTRS>/i.test(text) ? "bank" : null;
  const rows: StmtRow[] = [];
  let skipped = 0;
  const re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const b = m[1];
    const date = parseDate(tag(b, "DTPOSTED") ?? "");
    const cents = parseAmount((tag(b, "TRNAMT") ?? "").replace(",", "."));
    const name = unEntity(tag(b, "NAME") ?? ""), memo = unEntity(tag(b, "MEMO") ?? "");
    // NAME e MEMO costumam repetir um ao outro; junta só o que acrescenta
    const desc = [name, memo && memo !== name && !name.includes(memo) ? memo : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!date || cents === null || cents === 0 || !desc) { skipped++; continue; }
    const id = tag(b, "FITID") || undefined;
    rows.push({ date, desc: desc.slice(0, 200), cents, id });
  }
  const bal = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i);
  return {
    rows, kind, skipped, format: "ofx",
    balanceCents: bal ? parseAmount(bal[1].replace(",", ".")) : null,
    org: tag(text, "ORG"),
  };
}

// ------------------------------------------------------------------ CSV
function splitCSV(text: string, delim: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) out.push(row);
  return out;
}

const DATE_H = ["data", "date", "dt", "data lancamento", "data do lancamento", "data movimento", "data da transacao", "data transacao", "data da compra", "data mov"];
const DESC_H = ["descricao", "historico", "lancamento", "description", "title", "estabelecimento", "detalhes", "memo", "nome", "titulo", "descricao do lancamento"];
const AMOUNT_H = ["valor", "amount", "quantia", "value", "valor r", "valor brl", "valor em r"];
const DEBIT_H = ["debito", "saida", "saidas", "debit", "valor debito"];
const CREDIT_H = ["credito", "entrada", "entradas", "credit", "valor credito"];

export function parseCSV(text: string): StmtParsed {
  const head = text.split(/\r?\n/).slice(0, 15).join("\n");
  const count = (d: string) => (head.match(new RegExp(d === "\t" ? "\\t" : `\\${d}`, "g")) ?? []).length;
  const delim = [";", ",", "\t"].sort((a, b) => count(b) - count(a))[0];
  const all = splitCSV(text, delim);
  // linha de cabeçalho: a primeira que tem coluna de data e de valor (alguns bancos põem texto antes)
  let h = -1, cols: { date: number; desc: number[]; amount: number; debit: number; credit: number } | null = null;
  for (let i = 0; i < Math.min(all.length, 30); i++) {
    const n = all[i].map(norm);
    const find = (names: string[]) => n.findIndex((c) => names.includes(c));
    const date = find(DATE_H), amount = find(AMOUNT_H), debit = find(DEBIT_H), credit = find(CREDIT_H);
    if (date >= 0 && (amount >= 0 || (debit >= 0 && credit >= 0) || debit >= 0 || credit >= 0)) {
      const desc = n.map((c, k) => (DESC_H.includes(c) ? k : -1)).filter((k) => k >= 0);
      if (!desc.length) continue;
      h = i; cols = { date, desc, amount, debit, credit };
      break;
    }
  }
  if (h < 0 || !cols) throw new Error("Não achei as colunas de data, descrição e valor neste CSV. Confira se é o extrato do banco.");
  const rows: StmtRow[] = [];
  let skipped = 0;
  for (const r of all.slice(h + 1)) {
    const date = parseDate(r[cols.date] ?? "");
    const desc = cols.desc.map((k) => (r[k] ?? "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
    let cents: number | null = null;
    if (cols.amount >= 0) cents = parseAmount(r[cols.amount] ?? "");
    else {
      const d = cols.debit >= 0 ? parseAmount(r[cols.debit] ?? "") : null, c = cols.credit >= 0 ? parseAmount(r[cols.credit] ?? "") : null;
      cents = c ? Math.abs(c) : d ? -Math.abs(d) : null;
    }
    if (!date || cents === null || cents === 0 || !desc) { if (r.some((x) => x.trim())) skipped++; continue; }
    if (/^saldo (anterior|do dia|final|parcial|inicial|disponivel)/.test(norm(desc))) continue;
    rows.push({ date, desc: desc.slice(0, 200), cents });
  }
  return { rows, kind: null, balanceCents: null, org: null, format: "csv", skipped };
}

/** Entende o arquivo pelo conteúdo (OFX tem tags; o resto é tratado como CSV). */
export function parseStatement(text: string): StmtParsed {
  const parsed = /<OFX>|<STMTTRN>|OFXHEADER/i.test(text) ? parseOFX(text) : parseCSV(text);
  if (!parsed.rows.length) throw new Error("Nenhum lançamento legível neste arquivo.");
  return parsed;
}

/** Cartão que lista as compras como positivas (ex.: CSV do Nubank): sugere inverter os sinais. */
export const looksInverted = (rows: StmtRow[], kind: "bank" | "credit") =>
  kind === "credit" && rows.length > 0 && rows.filter((r) => r.cents > 0).length / rows.length > 0.8;

/** Numera linhas idênticas do arquivo (mesmo dia, valor e texto): dois cafés iguais no mesmo dia continuam sendo dois. */
export function numberDuplicates(rows: StmtRow[]): (StmtRow & { occ: number })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = `${r.date}|${r.cents}|${r.desc}`;
    const occ = seen.get(k) ?? 0;
    seen.set(k, occ + 1);
    return { ...r, occ };
  });
}
