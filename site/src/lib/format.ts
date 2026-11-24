export const brl = (cents: number, sign = false) => {
  const v = cents / 100;
  const s = Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "− " : sign && v > 0 ? "+ " : "") + "R$ " + s;
};

export const toCents = (n: number) => Math.round(n * 100);

const TZ = "America/Sao_Paulo";
export const dateBR = (iso: string | Date, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit" }) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, ...opts });
export const timeBR = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** Data local (São Paulo) em AAAA-MM-DD. */
export const todayBR = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

export const monthRange = (ym?: string) => {
  const base = ym ? new Date(ym + "-01T12:00:00") : new Date(todayBR() + "T12:00:00");
  const y = base.getFullYear(), m = base.getMonth();
  const start = new Date(Date.UTC(y, m, 1, 3)); // 00:00 em São Paulo
  const end = new Date(Date.UTC(y, m + 1, 1, 3));
  const label = base.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const key = `${y}-${String(m + 1).padStart(2, "0")}`;
  const prev = new Date(y, m - 1, 1), next = new Date(y, m + 1, 1);
  const k = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { start, end, label: label.charAt(0).toUpperCase() + label.slice(1), key, prev: k(prev), next: k(next), year: y, month: m };
};

/** Normaliza descrição para comparação: minúsculas, sem acento, sem números longos e datas. */
export const normalizeDesc = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, " ")
    .replace(/[*#\-_.]/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
