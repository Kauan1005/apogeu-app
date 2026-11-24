import { createClient, requireSession } from "@/lib/supabase/server";
import { getCategories } from "@/lib/queries";
import { Topbar } from "@/components/topbar";
import { Icon } from "@/components/ui";
import { HabitSuggestions, ReviewQueue, RuleSuggestions, type ReviewTx } from "./review-client";
import { suggestHabits } from "@/lib/habits";

export default async function Revisar() {
  const s = await requireSession();
  const db = await createClient();
  const [{ data }, cats, { data: rules }] = await Promise.all([
    db.from("transactions")
      .select("id, occurred_at, has_time, amount_cents, description, description_raw, counterpart_doc_masked, payment_method, category_id, confidence, accounts(name)")
      .eq("household_id", s.householdId).eq("status", "review").is("deleted_at", null)
      .order("occurred_at", { ascending: false }).limit(200),
    getCategories(db, s.householdId),
    db.from("rules").select("id, name, conditions, category_id").eq("household_id", s.householdId).eq("source", "suggested"),
  ]);
  const queue = (data ?? []) as unknown as ReviewTx[];
  const habits = await suggestHabits(db, s.householdId);

  // por que a sugestão: as transações mais parecidas já categorizadas (para a primeira da fila)
  let similar: { description: string; category_id: string; score: number }[] = [];
  if (queue[0]) {
    const { data: sim } = await db.rpc("similar_by_text", { q: queue[0].description, hid: s.householdId, lim: 3 });
    similar = (sim ?? []) as typeof similar;
  }

  return (
    <>
      <Topbar title="Revisar categorias" />
      <div className="content page-in">
        {queue.length ? (
          <ReviewQueue queue={queue} categories={cats} similar={similar} />
        ) : (
          <div className="card empty"><Icon name="check" size="lg" /><div style={{ fontSize: 18, fontWeight: 500 }}>Nada para revisar</div><div className="ink2">Toda transação nova com baixa confiança aparece aqui.</div></div>
        )}
        <HabitSuggestions items={habits} categories={cats} />
        {!!rules?.length && <RuleSuggestions rules={rules as { id: string; name: string; conditions: { value: string }[]; category_id: string }[]} categories={cats} />}
      </div>
    </>
  );
}
