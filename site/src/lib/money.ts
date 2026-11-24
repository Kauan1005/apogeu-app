// Valores digitados em reais, do jeito que a pessoa escreve: "1234,56", "1.234,56", "1234.56", "R$ 50".

/** Converte o texto em número (reais). Retorna NaN se não der para entender. */
export function parseMoney(input: string): number {
  let t = String(input ?? "").replace(/R\$|\s/g, "").trim();
  if (!t) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); // vírgula = decimal; pontos = milhar
  else if (!/\.\d{1,2}$/.test(t)) t = t.replace(/\./g, "");      // "1.234" é milhar; "12.5" é decimal
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** Formata para exibir no campo: 1234.5 → "1.234,50". */
export const formatMoneyInput = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
