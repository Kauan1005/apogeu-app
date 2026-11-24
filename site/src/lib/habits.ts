import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Habit = { key: string; name: string; category_id: string; count: number };

/**
 * Hábitos: destinatários que você já categorizou à mão pelo menos 2 vezes, sempre na mesma categoria, e que ainda não viraram regra.
 * Viram sugestão de uma vez só ("Criar estas N regras"), em vez de esperar a pergunta de uma em uma.
 */
export async function suggestHabits(db: SupabaseClient, hid: string, max = 5): Promise<Habit[]> {
  const [{ data: txs }, { data: payees }] = await Promise.all([
    db.from("transactions").select("payee_key, counterpart_name, description, category_id")
      .eq("household_id", hid).eq("category_source", "user").is("deleted_at", null).not("payee_key", "is", null).not("category_id", "is", null).limit(5000),
    db.from("payees").select("key").eq("household_id", hid),
  ]);
  const known = new Set((payees ?? []).map((p) => p.key as string));
  const by = new Map<string, { name: string; cats: Map<string, number>; total: number }>();
  for (const t of txs ?? []) {
    const k = t.payee_key as string;
    if (known.has(k)) continue;
    const e = by.get(k) ?? { name: String(t.counterpart_name || t.description), cats: new Map(), total: 0 };
    e.cats.set(t.category_id as string, (e.cats.get(t.category_id as string) ?? 0) + 1);
    e.total++;
    by.set(k, e);
  }
  return [...by.entries()]
    .filter(([, e]) => e.total >= 2 && e.cats.size === 1)
    .map(([key, e]) => ({ key, name: e.name, category_id: [...e.cats.keys()][0], count: e.total }))
    .sort((a, b) => b.count - a.count)
    .slice(0, max);
}
