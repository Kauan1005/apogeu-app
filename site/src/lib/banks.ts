/**
 * Cor predominante de cada banco, em tom um pouco mais vivo (neon suave) para ler bem no fundo escuro.
 * Só serve para realçar nome e ícone; o logo em si só aparece quando existe em fonte permitida (nunca uma imitação).
 */
const BRANDS: [RegExp, string][] = [
  [/bradesco/, "#FF3355"],
  [/mercado ?pago|mercado ?livre/, "#1FC3FF"],
  [/nubank|nu pagamentos|\bnu\b/, "#B24DFF"],
  [/ita[uú]/, "#FF9F1C"],
  [/\binter\b/, "#FF7A2F"],
  [/santander/, "#FF3B3B"],
  [/caixa/, "#2FA8FF"],
  [/banco do brasil|\bbb\b/, "#FFE600"],
  [/\bc6\b/, "#D9D9D9"],
  [/picpay/, "#2BFF8A"],
  [/\bbtg\b/, "#4D7CFF"],
  [/\bxp\b/, "#FFD400"],
  [/sicoob/, "#19E3CF"],
  [/sicredi/, "#7CFF4D"],
  [/original/, "#2BFF8A"],
  [/\bneon\b/, "#00E5FF"],
  [/\bwill\b/, "#FFE24D"],
  [/\bnext\b/, "#3DFF7A"],
  [/banrisul/, "#3D9BFF"],
  [/safra/, "#5C8DFF"],
];

/** Primeira cor reconhecida entre os nomes dados (conta, instituição...); null se nenhum for um banco conhecido. */
export function bankColor(...names: (string | null | undefined)[]): string | null {
  for (const n of names) {
    const key = (n ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (!key) continue;
    const hit = BRANDS.find(([re]) => re.test(key));
    if (hit) return hit[1];
  }
  return null;
}
