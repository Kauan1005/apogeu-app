import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthRange, todayBR } from "./format";

export type Cat = { id: string; slug: string; name: string; kind: string; color: string | null; icon: string | null; sort: number; parent_id: string | null; is_system: boolean; label: string };

/** Categorias em ordem de árvore (mãe, depois as filhas); `label` = "Mãe › Filha". Filhas herdam cor e ícone da mãe. */
export async function getCategories(db: SupabaseClient, hid: string): Promise<Cat[]> {
  const { data } = await db.from("categories").select("id, slug, name, kind, color, icon, sort, parent_id, is_system").eq("household_id", hid).order("sort").order("name");
  const all = (data ?? []) as Omit<Cat, "label">[];
  const out: Cat[] = [];
  for (const p of all.filter((c) => !c.parent_id)) {
    out.push({ ...p, label: p.name });
    for (const c of all.filter((x) => x.parent_id === p.id)) out.push({ ...c, color: c.color ?? p.color, icon: c.icon ?? p.icon, label: `${p.name} › ${c.name}` });
  }
  return out;
}

/** Categoria de topo (subcategoria sobe para a mãe) — usada em gráficos e orçamentos. */
export const topOf = (cats: Cat[], id: string | null) => {
  const c = cats.find((x) => x.id === id);
  return c?.parent_id ?? id ?? "none";
};

/** Gera as ocorrências do mês para as contas fixas ativas (idempotente). */
export async function ensureBillOccurrences(db: SupabaseClient, hid: string, ym: string) {
  const { year, month } = monthRange(ym);
  const { data: bills } = await db.from("bills").select("id, amount_cents, due_day, recurrence, starts_on, installments_total").eq("household_id", hid).eq("active", true);
  const last = new Date(year, month + 1, 0).getDate();
  const rows = (bills ?? [])
    .map((b) => {
      const due = `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(b.due_day, last)).padStart(2, "0")}`;
      const startYm = String(b.starts_on).slice(0, 7);
      if (b.recurrence === "once" && startYm !== ym) return null;
      if (startYm > ym) return null;
      if (b.recurrence === "installments") {
        const n = (year - Number(startYm.slice(0, 4))) * 12 + (month + 1 - Number(startYm.slice(5, 7)));
        if (n >= (b.installments_total ?? 0)) return null; // já terminou de pagar
      }
      return { bill_id: b.id, household_id: hid, due_date: due, amount_cents: b.amount_cents };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length) await db.from("bill_occurrences").upsert(rows, { onConflict: "bill_id,due_date", ignoreDuplicates: true });
}

type Tx = {
  id: string; occurred_at: string; amount_cents: number; description: string; category_id: string | null;
  is_internal_transfer: boolean; status: string; account_id: string; has_time: boolean;
  accounts: { name: string; institution: string | null; type: string } | null;
};

export async function getDashboard(db: SupabaseClient, hid: string, ym?: string) {
  const m = monthRange(ym);
  const today = todayBR();
  const isCurrent = m.key === today.slice(0, 7);
  await ensureBillOccurrences(db, hid, m.key);

  const sixAgo = new Date(Date.UTC(m.year, m.month - 5, 1, 3)).toISOString();
  const [cats, accs, txsRes, after, bills, review] = await Promise.all([
    getCategories(db, hid),
    db.from("accounts").select("id, type, balance_cents").eq("household_id", hid),
    db.from("transactions")
      .select("id, occurred_at, amount_cents, description, category_id, is_internal_transfer, status, account_id, has_time, accounts(name, institution, type)")
      .eq("household_id", hid).is("deleted_at", null).gte("occurred_at", sixAgo).lt("occurred_at", m.end.toISOString())
      .order("occurred_at", { ascending: true }).limit(5000),
    db.from("transactions").select("amount_cents, account_id, occurred_at").eq("household_id", hid).is("deleted_at", null).gte("occurred_at", m.start.toISOString()),
    db.from("bill_occurrences_status").select("id, name, due_date, amount_cents, status, category_id").eq("household_id", hid).neq("status", "pago").order("due_date").limit(20),
    db.from("transactions").select("id", { count: "exact", head: true }).eq("household_id", hid).eq("status", "review").is("deleted_at", null),
  ]);

  const catById = new Map(cats.map((c) => [c.id, c]));
  const cashAccounts = new Set((accs.data ?? []).filter((a) => a.type !== "credit").map((a) => a.id));
  const balance = (accs.data ?? []).filter((a) => a.type !== "credit").reduce((s, a) => s + Number(a.balance_cents), 0);
  const txs = (txsRes.data ?? []) as unknown as Tx[];
  const counts = (t: Tx) => !t.is_internal_transfer && catById.get(t.category_id ?? "")?.kind !== "transfer";
  const inMonth = txs.filter((t) => new Date(t.occurred_at) >= m.start && counts(t));

  const incomeCents = inMonth.filter((t) => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
  const expenseCents = inMonth.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0);

  // mesmo período do mês anterior
  const dayOfMonth = isCurrent ? Number(today.slice(8, 10)) : 31;
  const prev = monthRange(m.prev);
  const prevSame = txs.filter((t) => {
    const d = new Date(t.occurred_at);
    return d >= prev.start && d < prev.end && Number(d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(8, 10)) <= dayOfMonth && counts(t);
  });
  const prevExpense = prevSame.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0);
  const prevIncome = prevSame.filter((t) => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);

  // gastos por categoria: as categorias com cor própria; o resto vira "Demais"
  const byCat = new Map<string, number>();
  for (const t of inMonth) if (t.amount_cents < 0) { const k = topOf(cats, t.category_id); byCat.set(k, (byCat.get(k) ?? 0) - t.amount_cents); }
  const colored: { label: string; cents: number; color: string; id: string }[] = [];
  let restCents = 0, restN = 0;
  for (const [id, cents] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    const c = catById.get(id);
    if (c?.color) colored.push({ id, label: c.name, cents, color: `var(--${c.color})` });
    else { restCents += cents; restN++; }
  }
  const slices = [...colored, ...(restCents ? [{ id: "rest", label: `Demais (${restN})`, cents: restCents, color: "var(--c-rest)" }] : [])];

  // saldo diário (contas correntes e poupança), reconstruído a partir do saldo atual
  const lastDay = new Date(m.year, m.month + 1, 0).getDate();
  const todayIdx = isCurrent ? Number(today.slice(8, 10)) - 1 : lastDay - 1;
  const afterCash = (after.data ?? []).filter((t) => cashAccounts.has(t.account_id));
  const points: { day: number; cents: number }[] = [];
  const openBills = (bills.data ?? []) as { id: string; name: string; due_date: string; amount_cents: number; status: string; category_id: string | null }[];
  for (let d = 1; d <= lastDay; d++) {
    const endOfDay = new Date(Date.UTC(m.year, m.month, d + 1, 3));
    if (d - 1 <= todayIdx) {
      const later = afterCash.filter((t) => new Date(t.occurred_at) >= endOfDay).reduce((s, t) => s + Number(t.amount_cents), 0);
      points.push({ day: d, cents: balance - later });
    } else {
      const due = openBills.filter((b) => b.due_date.slice(0, 7) === m.key && Number(b.due_date.slice(8, 10)) <= d).reduce((s, b) => s + b.amount_cents, 0);
      points.push({ day: d, cents: points[todayIdx].cents - due });
    }
  }
  const openThisMonth = openBills.filter((b) => b.due_date.slice(0, 7) === m.key);
  const openCents = openThisMonth.reduce((s, b) => s + b.amount_cents, 0);

  // 6 meses
  const months = Array.from({ length: 6 }, (_, i) => {
    const r = monthRange(new Date(Date.UTC(m.year, m.month - 5 + i, 15)).toISOString().slice(0, 7));
    const list = txs.filter((t) => { const d = new Date(t.occurred_at); return d >= r.start && d < r.end && counts(t); });
    return {
      label: r.start.toLocaleDateString("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" }).replace(".", ""),
      inCents: list.filter((t) => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0),
      outCents: list.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0),
      partial: i === 5 && isCurrent,
    };
  });

  const top = inMonth.filter((t) => t.amount_cents < 0).sort((a, b) => a.amount_cents - b.amount_cents).slice(0, 5)
    .map((t) => ({ ...t, category: catById.get(t.category_id ?? "") ?? null }));

  // avisos: maior alta de categoria vs. mês anterior, cobranças duplicadas, fila de revisão
  const prevByCat = new Map<string, number>();
  for (const t of prevSame) if (t.amount_cents < 0) { const k = topOf(cats, t.category_id); prevByCat.set(k, (prevByCat.get(k) ?? 0) - t.amount_cents); }
  const growth = [...byCat.entries()]
    .map(([id, cents]) => ({ id, cents, prev: prevByCat.get(id) ?? 0 }))
    .filter((g) => g.prev > 5000 && g.cents > g.prev * 1.2)
    .map((g) => ({ ...g, pct: Math.round((g.cents / g.prev - 1) * 100), name: catById.get(g.id)?.name ?? "Sem categoria" }))
    .sort((a, b) => b.cents - b.prev - (a.cents - a.prev))[0] ?? null;
  const seen = new Map<string, Tx>();
  const duplicates: { a: Tx; b: Tx }[] = [];
  for (const t of inMonth) {
    if (t.amount_cents >= 0) continue;
    const k = `${t.description}|${t.amount_cents}|${t.occurred_at.slice(0, 10)}`;
    const p = seen.get(k);
    if (p) duplicates.push({ a: p, b: t }); else seen.set(k, t);
  }

  return {
    month: m, isCurrent, today, balance, incomeCents, expenseCents, prevExpense, prevIncome, dayOfMonth,
    slices, expenseTotal: expenseCents, points, todayIdx, months, top,
    openBills: openBills.slice(0, 4), openCents, projection: (isCurrent ? balance : points[points.length - 1]?.cents ?? balance) - (isCurrent ? openCents : 0),
    growth, duplicates, review: review.count ?? 0, hasData: txs.length > 0 || (accs.data ?? []).length > 0,
  };
}
