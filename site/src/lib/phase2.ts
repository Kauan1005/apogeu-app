import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthRange, normalizeDesc, todayBR } from "./format";
import { getCategories, topOf, type Cat } from "./queries";

const TZ = "America/Sao_Paulo";
const localDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 15));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const ymd = (ym: string, day: number) => `${ym}-${String(Math.min(day, lastDay(ym))).padStart(2, "0")}`;
const ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const monthLabel = (ym: string) => `${ABBR[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;

type Tx = {
  id: string; occurred_at: string; purchase_date: string | null; amount_cents: number; description: string; category_id: string | null;
  account_id: string; installment_number: number | null; total_installments: number | null; is_internal_transfer: boolean; status: string;
  payee_key: string | null; transaction_splits?: { category_id: string | null; amount_cents: number }[];
};

/** Gasto por categoria respeitando divisões (uma transação dividida conta em cada parte). */
export function spentByCategory(txs: Tx[], cats: Cat[]) {
  const transfer = new Set(cats.filter((c) => c.kind === "transfer").map((c) => c.id));
  const m = new Map<string, number>();
  for (const t of txs) {
    if (t.amount_cents >= 0 || t.is_internal_transfer || transfer.has(t.category_id ?? "")) continue;
    const parts = t.transaction_splits?.length ? t.transaction_splits : [{ category_id: t.category_id, amount_cents: t.amount_cents }];
    for (const p of parts) {
      const own = p.category_id ?? "none", top = topOf(cats, p.category_id);
      m.set(own, (m.get(own) ?? 0) - p.amount_cents);
      if (top !== own) m.set(top, (m.get(top) ?? 0) - p.amount_cents); // a mãe soma as filhas
    }
  }
  return m;
}

// ------------------------------------------------------------------ cartões de crédito
/** Fatura em que a compra cai: até o dia de fechamento entra na fatura do mês; depois, na do mês seguinte. */
export function invoiceOf(dateIso: string, closingDay: number | null) {
  const d = dateIso.slice(0, 10), ym = d.slice(0, 7), day = Number(d.slice(8, 10));
  if (!closingDay) return ym;
  return day <= closingDay ? ym : addMonths(ym, 1);
}
export function dueDateOf(invoiceYm: string, closingDay: number | null, dueDay: number | null) {
  if (!dueDay) return null;
  const ym = closingDay && dueDay <= closingDay ? addMonths(invoiceYm, 1) : invoiceYm;
  return ymd(ym, dueDay);
}

export async function getCards(db: SupabaseClient, hid: string) {
  const today = todayBR();
  const since = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 13, 1)).toISOString();
  const [{ data: accs }, cats] = await Promise.all([
    db.from("accounts").select("id, name, institution, number_masked, balance_cents, credit_limit_cents, closing_day, due_day").eq("household_id", hid).eq("type", "credit").order("name"),
    getCategories(db, hid),
  ]);
  const ids = (accs ?? []).map((a) => a.id);
  const { data: txData } = ids.length
    ? await db.from("transactions")
        .select("id, occurred_at, purchase_date, amount_cents, description, category_id, account_id, installment_number, total_installments, is_internal_transfer, status, payee_key")
        .in("account_id", ids).is("deleted_at", null).gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(5000)
    : { data: [] };
  const txs = (txData ?? []) as Tx[];
  const payCat = new Set(cats.filter((c) => c.slug === "fatura" || c.slug === "interna").map((c) => c.id));

  return (accs ?? []).map((a) => {
    const own = txs.filter((t) => t.account_id === a.id);
    const purchases = own.filter((t) => t.amount_cents < 0 && !payCat.has(t.category_id ?? ""));
    const currentInv = invoiceOf(today, a.closing_day);
    const byInvoice = new Map<string, Tx[]>();
    for (const t of purchases) {
      const inv = invoiceOf(localDate(t.occurred_at), a.closing_day);
      byInvoice.set(inv, [...(byInvoice.get(inv) ?? []), t]);
    }
    const invoices = [...byInvoice.entries()]
      .sort((x, y) => (x[0] < y[0] ? 1 : -1))
      .slice(0, 6)
      .map(([ym, list]) => ({
        ym, label: monthLabel(ym), totalCents: list.reduce((s, t) => s - t.amount_cents, 0), count: list.length,
        due: dueDateOf(ym, a.closing_day, a.due_day), open: ym >= currentInv,
      }));

    // parcelas futuras: cada compra parcelada projeta as parcelas que ainda faltam
    const future = new Map<string, number>();
    const active: { description: string; n: number; total: number; cents: number; left: number }[] = [];
    const seen = new Set<string>();
    for (const t of purchases) {
      if (!t.total_installments || !t.installment_number || t.installment_number >= t.total_installments) continue;
      const k = `${t.payee_key ?? t.description}|${t.total_installments}|${t.amount_cents}`;
      if (seen.has(k)) continue; // só a parcela mais recente de cada compra
      seen.add(k);
      const left = t.total_installments - t.installment_number;
      const inv = invoiceOf(localDate(t.occurred_at), a.closing_day);
      for (let i = 1; i <= left; i++) future.set(addMonths(inv, i), (future.get(addMonths(inv, i)) ?? 0) - t.amount_cents);
      active.push({ description: t.description, n: t.installment_number, total: t.total_installments, cents: -t.amount_cents, left });
    }
    const futureMonths = Array.from({ length: 6 }, (_, i) => {
      const ym = addMonths(currentInv, i + 1);
      return { ym, label: monthLabel(ym), cents: future.get(ym) ?? 0 };
    });

    const used = Math.abs(Number(a.balance_cents));
    const limit = a.credit_limit_cents ? Number(a.credit_limit_cents) : null;
    const best = a.closing_day ? (a.closing_day % lastDay(today.slice(0, 7))) + 1 : null;
    return {
      ...a, used, limit, best, currentInv,
      openCents: invoices.find((i) => i.ym === currentInv)?.totalCents ?? 0,
      nextDue: dueDateOf(currentInv, a.closing_day, a.due_day),
      invoices, futureMonths, futureTotal: [...future.values()].reduce((s, v) => s + v, 0), active,
    };
  });
}

// ------------------------------------------------------------------ orçamentos e metas
export async function getBudgets(db: SupabaseClient, hid: string, ym?: string) {
  const m = monthRange(ym);
  const [cats, { data: budgets }, { data: txData }] = await Promise.all([
    getCategories(db, hid),
    db.from("budgets").select("id, category_id, limit_cents, alert_pct").eq("household_id", hid),
    db.from("transactions").select("id, occurred_at, purchase_date, amount_cents, description, category_id, account_id, installment_number, total_installments, is_internal_transfer, status, payee_key, transaction_splits(category_id, amount_cents)")
      .eq("household_id", hid).is("deleted_at", null).gte("occurred_at", m.start.toISOString()).lt("occurred_at", m.end.toISOString()),
  ]);
  const spent = spentByCategory((txData ?? []) as Tx[], cats);
  const isCurrent = m.key === todayBR().slice(0, 7);
  const dayFrac = isCurrent ? Number(todayBR().slice(8, 10)) / lastDay(m.key) : 1;
  const rows = (budgets ?? []).map((b) => {
    const c = cats.find((x) => x.id === b.category_id)!;
    const s = spent.get(b.category_id) ?? 0;
    const pct = Math.round((s / Number(b.limit_cents)) * 100);
    const projected = isCurrent && dayFrac > 0 ? Math.round(s / dayFrac) : s;
    const state: "good" | "warning" | "critical" = pct >= 100 ? "critical" : pct >= b.alert_pct ? "warning" : "good";
    return { ...b, limit_cents: Number(b.limit_cents), category: c, spent: s, pct, projected, state };
  }).sort((a, b) => b.pct - a.pct);
  return { month: m, rows, cats, spent };
}

/** `pots`: saldo de cada cofrinho ("account:<id>" / "holding:<id>"). Meta ligada a cofrinhos usa esse saldo no lugar dos aportes. */
export type PotExtra = { names: Map<string, string>; yield30: number; totalCents: number };

/** Entrada líquida média por mês (últimos 3 meses) nos cofrinhos de nome dado, pelos lançamentos "Dinheiro reservado/retirado". */
async function potNetMonthly(db: SupabaseClient, hid: string, names: string[]) {
  if (!names.length) return 0;
  const clean = (n: string) => n.replace(/[,()%*]/g, "_");
  const { data } = await db.from("transactions").select("amount_cents").eq("household_id", hid).is("deleted_at", null)
    .gte("occurred_at", new Date(Date.now() - 90 * 864e5).toISOString())
    .or(names.flatMap((n) => [`description_raw.ilike.Dinheiro reservado ${clean(n)}%`, `description_raw.ilike.Dinheiro retirado ${clean(n)}%`]).join(",")).limit(2000);
  return Math.round(-(data ?? []).reduce((s, t) => s + Number(t.amount_cents), 0) / 3); // guardar = sai da conta (negativo); retirar = volta (positivo)
}

export async function getGoals(db: SupabaseClient, hid: string, pots: Map<string, number> = new Map(), extra?: PotExtra) {
  const today = todayBR();
  const from = monthRange(addMonths(today.slice(0, 7), -3)).start.toISOString();
  const to = monthRange(today.slice(0, 7)).start.toISOString();
  const [cats, { data: goals }, { data: contribs }, { data: txData }] = await Promise.all([
    getCategories(db, hid),
    db.from("goals").select("id, name, kind, target_cents, target_months, deadline, created_at, pot_refs").eq("household_id", hid).order("created_at"),
    db.from("goal_contributions").select("goal_id, amount_cents, at").eq("household_id", hid),
    db.from("transactions").select("id, occurred_at, purchase_date, amount_cents, description, category_id, account_id, installment_number, total_installments, is_internal_transfer, status, payee_key, transaction_splits(category_id, amount_cents)")
      .eq("household_id", hid).is("deleted_at", null).gte("occurred_at", from).lt("occurred_at", to),
  ]);
  // gasto médio dos últimos 3 meses fechados (base da reserva de emergência)
  const spent = [...spentByCategory((txData ?? []) as Tx[], cats).values()].reduce((s, v) => s + v, 0);
  const avgMonthly = Math.round(spent / 3);
  return Promise.all((goals ?? []).map(async (g) => {
    const refs = ((g as { pot_refs?: string[] | null }).pot_refs ?? []).filter((r) => pots.has(r));
    const linked = refs.length > 0;
    const saved = linked ? refs.reduce((s, r) => s + (pots.get(r) ?? 0), 0) : (contribs ?? []).filter((c) => c.goal_id === g.id).reduce((s, c) => s + Number(c.amount_cents), 0);
    const target = g.kind === "emergency" && g.target_months ? Math.max(avgMonthly * g.target_months, g.target_cents ?? 0) : Number(g.target_cents ?? 0);
    const monthsLeft = g.deadline ? Math.max(1, Math.round((new Date(g.deadline).getTime() - new Date(today).getTime()) / (30.4 * 864e5))) : null;
    const perMonth = monthsLeft ? Math.max(0, Math.ceil((target - saved) / monthsLeft)) : null;
    // ritmo mensal: aportes manuais dos últimos 3 meses; meta ligada a cofrinhos = entradas líquidas nos cofrinhos + a parte do rendimento deles
    const since90 = Date.now() - 90 * 864e5;
    let pace = 0;
    if (linked) {
      const net = await potNetMonthly(db, hid, refs.map((r) => extra?.names.get(r)).filter((n): n is string => !!n));
      pace = net + (extra && extra.totalCents > 0 ? Math.round((extra.yield30 * saved) / extra.totalCents) : 0);
    } else {
      pace = Math.round((contribs ?? []).filter((c) => c.goal_id === g.id && Date.parse(String(c.at)) >= since90).reduce((s, c) => s + Number(c.amount_cents), 0) / 3);
    }
    let eta: string | null = null;
    if (target > saved && pace > 0) {
      const months = Math.ceil((target - saved) / pace);
      if (months <= 120) {
        const dt = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + months, 15));
        eta = `${dt.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "")}/${dt.getUTCFullYear()}`;
      }
    }
    return { ...g, saved, linked, target, avgMonthly, pct: target ? Math.min(100, Math.round((saved / target) * 100)) : 0, perMonth, monthsLeft, paceCents: pace, eta };
  }));
}

// ------------------------------------------------------------------ cobranças recorrentes
export type Recurring = {
  key: string; name: string; categoryId: string | null; cadence: "semanal" | "mensal" | "anual";
  amountCents: number; lastCents: number; lastAt: string; nextAt: string; count: number;
  aboveUsual: boolean; duplicate: { at: string; cents: number } | null; status: "confirmed" | "ignored" | null;
  /** cobrança que sumiu: passou 1,6 ciclo sem cobrar */
  stopped: boolean;
  /** cobra há 3+ ciclos e você nunca confirmou que usa: pode estar esquecida */
  forgotten: boolean;
};

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

/**
 * Detecta cobranças recorrentes nos últimos 12 meses: mesmo destinatário, valor parecido (±15%)
 * e intervalo regular (semanal, mensal ou anual), com 3 ou mais ocorrências (anual: 2).
 * Também marca valor acima do padrão e cobrança repetida em até 3 dias.
 */
export async function getRecurring(db: SupabaseClient, hid: string) {
  const today = todayBR();
  const since = new Date(new Date(today).getTime() - 400 * 864e5).toISOString();
  const [{ data }, { data: flags }, cats] = await Promise.all([
    db.from("transactions").select("id, occurred_at, amount_cents, description, category_id, payee_key, is_internal_transfer, status")
      .eq("household_id", hid).is("deleted_at", null).lt("amount_cents", 0).gte("occurred_at", since).order("occurred_at").limit(10000),
    db.from("recurring_flags").select("key, status").eq("household_id", hid),
    getCategories(db, hid),
  ]);
  const transfer = new Set(cats.filter((c) => c.kind === "transfer").map((c) => c.id));
  const groups = new Map<string, { at: string; cents: number; name: string; cat: string | null }[]>();
  for (const t of data ?? []) {
    if (t.is_internal_transfer || t.status === "canceled" || transfer.has(t.category_id ?? "")) continue;
    const key = t.payee_key ?? `d:${normalizeDesc(t.description).split(" ").slice(0, 3).join(" ")}`;
    groups.set(key, [...(groups.get(key) ?? []), { at: t.occurred_at, cents: -t.amount_cents, name: t.description, cat: t.category_id }]);
  }
  const flagMap = new Map((flags ?? []).map((f) => [f.key, f.status as "confirmed" | "ignored"]));
  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const med = median(list.map((x) => x.cents));
    // cobranças repetidas: mesmo valor em até 3 dias
    let duplicate: Recurring["duplicate"] = null;
    for (let i = 1; i < list.length; i++) {
      const gap = (new Date(list[i].at).getTime() - new Date(list[i - 1].at).getTime()) / 864e5;
      if (gap <= 3 && Math.abs(list[i].cents - list[i - 1].cents) <= 1) duplicate = { at: list[i].at, cents: list[i].cents };
    }
    const regular = list.filter((x) => Math.abs(x.cents - med) <= med * 0.15);
    const days = regular.slice(1).map((x, i) => (new Date(x.at).getTime() - new Date(regular[i].at).getTime()) / 864e5).filter((d) => d > 3);
    const gap = median(days);
    const cadence = gap >= 6 && gap <= 8 ? "semanal" : gap >= 25 && gap <= 35 ? "mensal" : gap >= 350 && gap <= 380 ? "anual" : null;
    if (!cadence || regular.length < (cadence === "anual" ? 2 : 3)) {
      if (duplicate && list.length >= 2) {
        out.push({ key, name: list.at(-1)!.name, categoryId: list.at(-1)!.cat, cadence: "mensal", amountCents: med, lastCents: list.at(-1)!.cents, lastAt: list.at(-1)!.at, nextAt: "", count: list.length, aboveUsual: false, duplicate, status: flagMap.get(key) ?? null, stopped: false, forgotten: false });
      }
      continue;
    }
    const last = list.at(-1)!;
    const next = new Date(new Date(last.at).getTime() + gap * 864e5).toISOString();
    const sinceLast = (new Date(today + "T12:00:00").getTime() - new Date(last.at).getTime()) / 864e5;
    const stopped = sinceLast > gap * 1.6;
    const status = flagMap.get(key) ?? null;
    out.push({
      key, name: last.name, categoryId: last.cat, cadence, amountCents: med, lastCents: last.cents, lastAt: last.at, nextAt: stopped ? "" : next,
      count: regular.length, aboveUsual: last.cents > med * 1.15, duplicate, status,
      stopped, forgotten: !stopped && status === null && regular.length >= 3,
    });
  }
  return { items: out.sort((a, b) => b.amountCents - a.amountCents), cats };
}

// ------------------------------------------------------------------ perguntas em linguagem natural (por filtros)
const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export type Question = { kind: "expense" | "income"; ym: string; categoryIds: string[]; text: string | null; top: boolean; understood: string };

/** Interpreta perguntas como "quanto gastei com lazer em outubro?" ou "quanto recebi mês passado?". */
export function parseQuestion(q: string, cats: Cat[], today = todayBR()): Question {
  const n = normalizeDesc(q).replace(/[?!.,]/g, " ").replace(/\s+/g, " ");
  const kind = /\b(recebi|ganhei|entrou|entradas|receita|salario)\b/.test(n) ? "income" : "expense";
  let ym = today.slice(0, 7);
  if (/mes passado|ultimo mes/.test(n)) ym = addMonths(ym, -1);
  const mi = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`).test(n));
  if (mi >= 0) {
    const yMatch = n.match(/\b(20\d{2})\b/);
    let y = yMatch ? Number(yMatch[1]) : Number(today.slice(0, 4));
    if (!yMatch && mi + 1 > Number(today.slice(5, 7))) y -= 1; // "outubro" em janeiro = outubro passado
    ym = `${y}-${String(mi + 1).padStart(2, "0")}`;
  }
  const categoryIds = cats.filter((c) => {
    const name = normalizeDesc(c.name);
    return n.includes(name) || n.includes(c.slug) || (name.endsWith("s") && n.includes(name.slice(0, -1)));
  }).map((c) => c.id);
  for (const c of cats) if (c.parent_id && categoryIds.includes(c.parent_id) && !categoryIds.includes(c.id)) categoryIds.push(c.id);
  const text = n.match(/\b(?:no|na|em|com) ([a-z0-9][a-z0-9 ]{2,30}?)(?: em | no mes| mes|$)/)?.[1]?.trim() ?? null;
  const merchant = text && !categoryIds.length && !MONTHS.includes(text) && !/mes|passado/.test(text) ? text : null;
  const top = /\b(maiores|maior|onde mais|top)\b/.test(n);
  const parts = [kind === "income" ? "entradas" : "gastos", categoryIds.length ? `em ${cats.filter((c) => categoryIds.includes(c.id) && !(c.parent_id && categoryIds.includes(c.parent_id))).map((c) => c.name).join(", ")}` : merchant ? `com “${merchant}”` : "em todas as categorias", `em ${monthRange(ym).label.toLowerCase()}`];
  return { kind, ym, categoryIds, text: merchant, top, understood: parts.join(" ") };
}

export async function answerQuestion(db: SupabaseClient, hid: string, q: Question) {
  const m = monthRange(q.ym);
  const cats = await getCategories(db, hid);
  const { data } = await db.from("transactions")
    .select("id, occurred_at, purchase_date, amount_cents, description, category_id, account_id, installment_number, total_installments, is_internal_transfer, status, payee_key, transaction_splits(category_id, amount_cents)")
    .eq("household_id", hid).is("deleted_at", null).gte("occurred_at", m.start.toISOString()).lt("occurred_at", m.end.toISOString()).limit(5000);
  const transfer = new Set(cats.filter((c) => c.kind === "transfer").map((c) => c.id));
  const rows = ((data ?? []) as Tx[]).filter((t) =>
    (q.kind === "income" ? t.amount_cents > 0 : t.amount_cents < 0) && !t.is_internal_transfer && !transfer.has(t.category_id ?? "") &&
    (!q.text || normalizeDesc(t.description).includes(q.text)));
  let total = 0;
  const hits: { id: string; description: string; occurred_at: string; cents: number; category_id: string | null }[] = [];
  for (const t of rows) {
    const parts = t.transaction_splits?.length ? t.transaction_splits : [{ category_id: t.category_id, amount_cents: t.amount_cents }];
    for (const p of parts) {
      if (q.categoryIds.length && !q.categoryIds.includes(p.category_id ?? "")) continue;
      total += Math.abs(p.amount_cents);
      hits.push({ id: t.id, description: t.description, occurred_at: t.occurred_at, cents: Math.abs(p.amount_cents), category_id: p.category_id });
    }
  }
  // comparação com o mês anterior, mesmo filtro
  const prevQ = { ...q, ym: addMonths(q.ym, -1) };
  const prevTotal = q.ym === prevQ.ym ? 0 : await (async () => {
    const pm = monthRange(prevQ.ym);
    const { data: p } = await db.from("transactions").select("amount_cents, category_id, description, is_internal_transfer, transaction_splits(category_id, amount_cents)")
      .eq("household_id", hid).is("deleted_at", null).gte("occurred_at", pm.start.toISOString()).lt("occurred_at", pm.end.toISOString()).limit(5000);
    let s = 0;
    for (const t of (p ?? []) as Tx[]) {
      if ((q.kind === "income" ? t.amount_cents <= 0 : t.amount_cents >= 0) || t.is_internal_transfer || transfer.has(t.category_id ?? "")) continue;
      if (q.text && !normalizeDesc(t.description).includes(q.text)) continue;
      const parts = t.transaction_splits?.length ? t.transaction_splits : [{ category_id: t.category_id, amount_cents: t.amount_cents }];
      for (const x of parts) if (!q.categoryIds.length || q.categoryIds.includes(x.category_id ?? "")) s += Math.abs(x.amount_cents);
    }
    return s;
  })();
  return { total, prevTotal, count: hits.length, top: hits.sort((a, b) => b.cents - a.cents).slice(0, q.top ? 10 : 5), month: m, cats };
}

// ------------------------------------------------------------------ orçamentos sugeridos
export type BudgetSuggestion = { category_id: string; name: string; color: string | null; limit_cents: number; avg_cents: number };

/**
 * Três orçamentos a partir das maiores categorias de gasto dos últimos 3 meses completos (média mensal,
 * arredondada para cima em R$ 50). Só categorias principais, sem orçamento ainda.
 */
export async function suggestBudgets(db: SupabaseClient, hid: string, max = 3): Promise<BudgetSuggestion[]> {
  const ym = todayBR().slice(0, 7);
  const start = monthRange(addMonths(ym, -3)).start, end = monthRange(ym).start;
  const [cats, { data: txs }, { data: existing }] = await Promise.all([
    getCategories(db, hid),
    db.from("transactions").select("occurred_at, amount_cents, is_internal_transfer, category_id, transaction_splits(category_id, amount_cents)")
      .eq("household_id", hid).is("deleted_at", null).neq("status", "canceled")
      .gte("occurred_at", start.toISOString()).lt("occurred_at", end.toISOString()).limit(5000),
    db.from("budgets").select("category_id").eq("household_id", hid),
  ]);
  const rows = (txs ?? []) as unknown as (Tx & { occurred_at: string })[];
  if (!rows.length) return [];
  const months = Math.max(1, new Set(rows.map((t) => t.occurred_at.slice(0, 7))).size);
  const spent = spentByCategory(rows, cats);
  const has = new Set((existing ?? []).map((b) => b.category_id));
  return cats
    .filter((c) => !c.parent_id && c.kind === "expense" && !has.has(c.id) && (spent.get(c.id) ?? 0) > 0)
    .map((c) => ({ c, avg: Math.round((spent.get(c.id) ?? 0) / months) }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, max)
    .map(({ c, avg }) => ({ category_id: c.id, name: c.name, color: c.color, avg_cents: avg, limit_cents: Math.max(5000, Math.ceil(avg / 5000) * 5000) }));
}

// ------------------------------------------------------------------ cofrinhos (poupança e aplicações dos bancos)
export type PotItem = { key: string; kind: "account" | "holding" | "pot"; id: string; name: string; cents: number; hidden: boolean; rate?: number | null };
export type PotGroup = { bank: string; cents: number; items: PotItem[] };

// aplicações que não são "guardado": ações, fundos, previdência, COE
const NOT_A_POT = new Set(["Ações", "ETF", "Fundo", "Previdência", "COE"]);

/**
 * O que está guardado nos bancos conectados: contas poupança e aplicações de renda fixa (onde ficam os cofrinhos,
 * caixinhas e reservas). Agrupa por banco; vários no mesmo banco aparecem separados e somados.
 * Itens ocultados ("isto não é um cofrinho") não entram no total.
 */
export async function getCofrinhos(db: SupabaseClient, hid: string) {
  const [accs, hold, pots] = await Promise.all([
    db.from("accounts").select("id, name, institution, balance_cents, pot_hidden").eq("household_id", hid).eq("type", "savings"),
    db.from("holdings").select("id, name, value_cents, details, pot_hidden").eq("household_id", hid).eq("side", "asset").eq("category", "investimento").eq("source", "pluggy"),
    db.from("account_pots").select("id, account_id, name, value_cents, rate_pct, hidden, accounts(name, institution)").eq("household_id", hid),
  ]);
  const bankOf = (a: { name: string; institution: string | null }) => (/meu ?pluggy/i.test(a.institution ?? "") || !a.institution ? a.name : a.institution);
  const items: (PotItem & { bank: string })[] = [
    // cofrinhos que o banco entrega dentro da conta (saldos reservados): cada um é um item
    ...(pots.data ?? []).map((x) => {
      const acc = x.accounts as unknown as { name: string; institution: string | null } | null;
      return { key: `p:${x.id}`, kind: "pot" as const, id: x.id as string, bank: acc ? bankOf(acc).replace(/\s*\(.*\)\s*$/, "") : "Outros bancos", name: String(x.name), cents: Number(x.value_cents), hidden: !!x.hidden, rate: x.rate_pct != null ? Number(x.rate_pct) : null };
    }),
    ...(accs.data ?? []).map((a) => ({ key: `a:${a.id}`, kind: "account" as const, id: a.id as string, bank: bankOf(a), name: "Poupança", cents: Number(a.balance_cents), hidden: !!a.pot_hidden })),
    ...(hold.data ?? [])
      .filter((h) => !NOT_A_POT.has(String((h.details as { kind?: string } | null)?.kind ?? "")))
      .map((h) => ({ key: `h:${h.id}`, kind: "holding" as const, id: h.id as string, bank: String((h.details as { issuer?: string | null } | null)?.issuer || "Outros bancos"), name: String(h.name), cents: Number(h.value_cents), hidden: !!h.pot_hidden })),
  ].filter((i) => i.cents > 0);
  const byBank = new Map<string, PotItem[]>();
  for (const { bank, ...i } of items) byBank.set(bank, [...(byBank.get(bank) ?? []), i]);
  const groups: PotGroup[] = [...byBank.entries()].map(([bank, list]) => ({
    bank, items: list.sort((a, b) => b.cents - a.cents), cents: list.filter((i) => !i.hidden).reduce((s, i) => s + i.cents, 0),
  })).sort((a, b) => b.cents - a.cents);
  // quanto os cofrinhos renderam nos últimos 30 dias (os lançamentos "Rendimentos" das contas que têm cofrinho ou poupança)
  const accIds = [...new Set([...(pots.data ?? []).map((x) => x.account_id as string), ...(accs.data ?? []).map((a) => a.id as string)])];
  let yield30 = 0;
  if (accIds.length) {
    const { data: cat } = await db.from("categories").select("id").eq("household_id", hid).eq("slug", "rendimentos").maybeSingle();
    if (cat) {
      const { data: ys } = await db.from("transactions").select("amount_cents").eq("household_id", hid).eq("category_id", cat.id).in("account_id", accIds)
        .gt("amount_cents", 0).is("deleted_at", null).gte("occurred_at", new Date(Date.now() - 30 * 864e5).toISOString()).limit(3000);
      yield30 = (ys ?? []).reduce((s, y) => s + Number(y.amount_cents), 0);
    }
  }
  return { total: groups.reduce((s, g) => s + g.cents, 0), groups, hiddenCount: items.filter((i) => i.hidden).length, yield30 };
}
