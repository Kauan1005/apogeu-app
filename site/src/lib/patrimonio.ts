import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayBR } from "./format";
import { getCards, monthLabel } from "./phase2";

export type Holding = {
  id: string; side: "asset" | "liability"; category: string; name: string; value_cents: number;
  source: "manual" | "pluggy"; details: Record<string, unknown>; updated_at: string;
  acquisition_cents: number | null; acquired_on: string | null;
};

export const HOLDING_CATS = {
  investimento: { label: "Investimentos", side: "asset", icon: "trend" },
  imovel: { label: "Imóveis", side: "asset", icon: "home" },
  veiculo: { label: "Veículos", side: "asset", icon: "car" },
  outro_bem: { label: "Outros bens", side: "asset", icon: "bag" },
  financiamento: { label: "Financiamentos", side: "liability", icon: "landmark" },
  emprestimo: { label: "Empréstimos", side: "liability", icon: "receipt" },
  outra_divida: { label: "Outras dívidas", side: "liability", icon: "alert" },
} as const;
export type HoldingCat = keyof typeof HOLDING_CATS;

export type Breakdown = { cash: number; investimento: number; bens: number; cartao: number; dividas: number; parcelas: number };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Patrimônio de agora: saldo das contas + investimentos + bens − fatura dos cartões − dívidas. */
export async function currentNetWorth(db: SupabaseClient, hid: string) {
  const [accs, hold, cards, bills, potRows] = await Promise.all([
    db.from("accounts").select("id, type, balance_cents").eq("household_id", hid),
    db.from("holdings").select("id, side, category, name, value_cents, source, details, updated_at, acquisition_cents, acquired_on").eq("household_id", hid).order("value_cents", { ascending: false }),
    getCards(db, hid),
    db.from("bills").select("amount_cents, starts_on, installments_total").eq("household_id", hid).eq("active", true).eq("recurrence", "installments"),
    db.from("account_pots").select("id, name, value_cents, updated_at, accounts(name)").eq("household_id", hid),
  ]);
  // carnês: parcelas que ainda faltam (a do mês corrente conta como a vencer)
  const ym = todayBR().slice(0, 7);
  const carnes = sum((bills.data ?? []).map((b) => {
    const start = String(b.starts_on).slice(0, 7);
    const elapsed = (Number(ym.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(ym.slice(5, 7)) - Number(start.slice(5, 7));
    return Math.max(0, (b.installments_total ?? 0) - Math.max(0, elapsed)) * Number(b.amount_cents);
  }));
  const accounts = accs.data ?? [];
  const holdings = (hold.data ?? []).map((h) => ({ ...h, value_cents: Number(h.value_cents) })) as Holding[];
  // cofrinhos dentro das contas dos bancos (Mercado Pago etc.): dinheiro guardado, conta como investimento (aparecem na lista, sem edição)
  for (const x of potRows.data ?? []) {
    if (Number(x.value_cents) <= 0) continue;
    const bank = String((x.accounts as unknown as { name?: string } | null)?.name ?? "Banco").replace(/\s*\(.*\)\s*$/, "");
    holdings.push({ id: `pot:${x.id}`, side: "asset", category: "investimento", name: `${bank} · ${x.name}`, value_cents: Number(x.value_cents), source: "pluggy", details: { kind: "Cofrinho" }, updated_at: x.updated_at as string, acquisition_cents: null, acquired_on: null });
  }
  const b: Breakdown = {
    cash: sum(accounts.filter((a) => a.type !== "credit").map((a) => Number(a.balance_cents))),
    cartao: sum(accounts.filter((a) => a.type === "credit").map((a) => Math.abs(Number(a.balance_cents)))),
    investimento: sum(holdings.filter((h) => h.category === "investimento").map((h) => h.value_cents)),
    bens: sum(holdings.filter((h) => h.side === "asset" && h.category !== "investimento").map((h) => h.value_cents)),
    dividas: sum(holdings.filter((h) => h.side === "liability").map((h) => h.value_cents)),
    parcelas: sum(cards.map((c) => c.futureTotal)) + carnes,
  };
  const assets = Math.max(0, b.cash) + b.investimento + b.bens;
  const liabilities = b.cartao + b.dividas + b.parcelas + Math.max(0, -b.cash); // conta no negativo (cheque especial) é dívida
  return { breakdown: b, assets, liabilities, net: assets - liabilities, holdings, cashAccountIds: accounts.filter((a) => a.type !== "credit").map((a) => a.id as string) };
}

const monthStart = (ym: string) => `${ym}-01`;
const ymOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
const shiftYm = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/** Grava (ou atualiza) a foto do mês corrente. Chamado ao abrir a tela e pelo cron diário. */
export async function takeSnapshot(db: SupabaseClient, hid: string, nw?: Awaited<ReturnType<typeof currentNetWorth>>) {
  const n = nw ?? (await currentNetWorth(db, hid));
  await db.from("net_worth_snapshots").upsert(
    { household_id: hid, month: monthStart(todayBR().slice(0, 7)), assets_cents: n.assets, liabilities_cents: n.liabilities, breakdown: n.breakdown, taken_at: new Date().toISOString() },
    { onConflict: "household_id,month" },
  );
  return n;
}

/**
 * Evolução dos últimos 12 meses. Mês com foto usa a foto; mês sem foto (antes de existir o recurso)
 * é estimado: o saldo das contas volta no tempo desfazendo as transações, e o resto fica como hoje.
 */
export async function netWorthHistory(db: SupabaseClient, hid: string, nw: Awaited<ReturnType<typeof currentNetWorth>>) {
  const cur = todayBR().slice(0, 7);
  const first = shiftYm(cur, -11);
  const [{ data: snaps }, txs] = await Promise.all([
    db.from("net_worth_snapshots").select("month, assets_cents, liabilities_cents").eq("household_id", hid).gte("month", monthStart(first)),
    fetchAll(db, hid, nw.cashAccountIds, monthStart(first)),
  ]);
  const snap = new Map((snaps ?? []).map((s) => [String(s.month).slice(0, 7), Number(s.assets_cents) - Number(s.liabilities_cents)]));
  const oldest = txs.length ? ymOf(new Date(txs[0].occurred_at)) : cur;
  // soma das transações por mês, para desfazer do presente para trás
  const perMonth = new Map<string, number>();
  for (const t of txs) { const k = ymOf(new Date(t.occurred_at)); perMonth.set(k, (perMonth.get(k) ?? 0) + Number(t.amount_cents)); }
  const out: { ym: string; label: string; cents: number; estimated: boolean }[] = [];
  let undo = 0; // o que entrou/saiu depois do fim do mês em questão
  for (let i = 0; i < 12; i++) {
    const ym = shiftYm(cur, -i);
    if (i > 0) undo += perMonth.get(shiftYm(ym, 1)) ?? 0;
    if (ym < oldest && !snap.has(ym)) break;
    const real = snap.get(ym);
    out.push({ ym, label: monthLabel(ym), cents: i === 0 ? nw.net : real ?? nw.net - undo, estimated: i > 0 && real == null });
  }
  return out.reverse();
}

async function fetchAll(db: SupabaseClient, hid: string, accountIds: string[], from: string) {
  if (!accountIds.length) return [] as { occurred_at: string; amount_cents: number }[];
  const all: { occurred_at: string; amount_cents: number }[] = [];
  for (let page = 0; page < 20; page++) {
    const { data } = await db.from("transactions").select("occurred_at, amount_cents")
      .eq("household_id", hid).in("account_id", accountIds).is("deleted_at", null).gte("occurred_at", from)
      .order("occurred_at").range(page * 1000, page * 1000 + 999);
    all.push(...((data ?? []) as typeof all));
    if (!data || data.length < 1000) break;
  }
  return all;
}
