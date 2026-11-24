import type { SupabaseClient } from "@supabase/supabase-js";
import { getCofrinhos, getGoals } from "@/lib/phase2";
import { todayBR } from "@/lib/format";

export type NudgeGoal = { id: string; name: string; saved: number; target: number; pace: number; eta: string | null; linked: boolean };
export type SavingsNudge = { txId: string; description: string; amountCents: number; at: string; todayYm: string; goals: NudgeGoal[] };

const MIN_CENTS = 50_000; // abaixo de R$ 500 não é salário

/**
 * Salário que caiu nos últimos 10 dias e ainda não foi tratado: a entrada da categoria Salário ou, na falta dela,
 * uma entrada grande (≥ R$ 1.000 e ≥ 60% da maior entrada dos 90 dias anteriores). Devolve também as metas em aberto,
 * para mostrar o efeito de guardar uma parte todo mês.
 */
export async function getSavingsNudge(db: SupabaseClient, hid: string): Promise<SavingsNudge | null> {
  const today = todayBR();
  const since = new Date(Date.now() - 10 * 864e5).toISOString();
  const since90 = new Date(Date.now() - 100 * 864e5).toISOString();
  const [{ data: cats }, { data: recent }, { data: older }, { data: handled }] = await Promise.all([
    db.from("categories").select("id, slug, kind").eq("household_id", hid),
    db.from("transactions").select("id, occurred_at, amount_cents, description, category_id").eq("household_id", hid).is("deleted_at", null)
      .eq("is_internal_transfer", false).gt("amount_cents", MIN_CENTS - 1).gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(20),
    db.from("transactions").select("amount_cents").eq("household_id", hid).is("deleted_at", null).eq("is_internal_transfer", false)
      .gt("amount_cents", 0).gte("occurred_at", since90).lt("occurred_at", since).order("amount_cents", { ascending: false }).limit(1),
    db.from("savings_nudges").select("transaction_id").eq("household_id", hid),
  ]);
  const done = new Set((handled ?? []).map((h) => h.transaction_id as string));
  const bySlug = new Map((cats ?? []).map((c) => [c.id as string, c as { slug: string; kind: string }]));
  const big = Number(older?.[0]?.amount_cents ?? 0);
  const tx = (recent ?? []).find((t) => {
    if (done.has(t.id as string)) return false;
    const c = bySlug.get(t.category_id as string);
    if (c?.kind === "transfer") return false;
    if (c?.slug === "salario") return true;
    const cents = Number(t.amount_cents);
    return cents >= 100_000 && (!big || cents >= big * 0.6);
  });
  if (!tx) return null;

  const pots = await getCofrinhos(db, hid);
  const potMap = new Map(pots.groups.flatMap((g) => g.items.map((i) => [`${i.kind}:${i.id}`, i.cents] as const)));
  const goals = await getGoals(db, hid, potMap, {
    names: new Map(pots.groups.flatMap((g) => g.items.filter((i) => i.kind === "pot").map((i) => [`pot:${i.id}`, i.name] as const))),
    yield30: pots.yield30, totalCents: pots.total,
  });
  return {
    txId: tx.id as string, description: String(tx.description ?? "Entrada"), amountCents: Number(tx.amount_cents), at: String(tx.occurred_at), todayYm: today.slice(0, 7),
    goals: goals.filter((g) => g.target > g.saved).slice(0, 3).map((g) => ({ id: g.id as string, name: String(g.name), saved: g.saved, target: g.target, pace: g.paceCents, eta: g.eta, linked: g.linked })),
  };
}
