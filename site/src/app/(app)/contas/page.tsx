import { createClient, requireSession } from "@/lib/supabase/server";
import { ensureBillOccurrences, getCategories } from "@/lib/queries";
import { monthRange, todayBR } from "@/lib/format";
import { Topbar } from "@/components/topbar";
import { PushToggle } from "@/components/push-toggle";
import { Icon, Money } from "@/components/ui";
import { BillRow } from "./bills-client";
import { BillCalendar } from "./bill-calendar";

type Occ = { id: string; bill_id: string; name: string; due_date: string; amount_cents: number; status: "pago" | "pendente" | "atrasado"; paid_at: string | null; paid_source: string | null; matched_transaction_id: string | null; recurrence: string; code: string | null; payment_code: string | null; installment_no: number | null; installments_total: number | null };

export default async function Contas({ searchParams }: PageProps<"/contas">) {
  const s = await requireSession();
  const { mes } = (await searchParams) as { mes?: string };
  const m = monthRange(mes);
  const db = await createClient();
  await ensureBillOccurrences(db, s.householdId, m.key);
  const [{ data }, cats] = await Promise.all([
    db.from("bill_occurrences_status").select("*").eq("household_id", s.householdId)
      .gte("due_date", `${m.key}-01`).lt("due_date", `${m.next}-01`).order("due_date"),
    getCategories(db, s.householdId),
  ]);
  const occ = (data ?? []) as Occ[];
  const sum = (st: string) => occ.filter((o) => o.status === st).reduce((a, o) => a + o.amount_cents, 0);
  const open = occ.filter((o) => o.status !== "pago");
  const today = todayBR();

  // calendário com a semana começando na segunda
  const first = new Date(m.year, m.month, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(m.year, m.month + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, i) => i - offset + 1);

  return (
    <>
      <Topbar title="Contas a pagar" month={{ label: m.label, prev: m.prev, next: m.next }}><PushToggle /></Topbar>
      <div className="content page-in grid">
        <div className="bento">
          <div className="card kpi s4"><h3>Em aberto no mês</h3><div className="v"><Money cents={sum("pendente") + sum("atrasado")} /></div><div className="d">{open.length} {open.length === 1 ? "conta" : "contas"}</div></div>
          <div className="card kpi s4"><h3>Atrasadas</h3><div className="v"><Money cents={sum("atrasado")} className={sum("atrasado") ? "out" : ""} /></div><div className="d"><Icon name="alert" size="sm" />{(() => { const n = occ.filter((o) => o.status === "atrasado").length; return `${n} ${n === 1 ? "venceu" : "venceram"} sem pagamento`; })()}</div></div>
          <div className="card kpi s4"><h3>Pagas</h3><div className="v"><Money cents={sum("pago")} /></div><div className="d"><Icon name="check" size="sm" />{(() => { const n = occ.filter((o) => o.paid_source === "auto").length; return `${n} ${n === 1 ? "conciliada" : "conciliadas"} pelo extrato`; })()}</div></div>

          <div className="card s5">
            <BillCalendar monthKey={m.key} monthLabel={m.label} cells={cells} days={days} today={today}
              occ={occ.map((o) => ({ id: o.id, name: o.name, due_date: o.due_date, amount_cents: o.amount_cents, status: o.status }))}
              categories={cats.filter((c) => c.kind === "expense").map((c) => ({ id: c.id, name: c.label, slug: c.slug }))} />
          </div>

          <div className="card s7">
            <h3>Vencimentos</h3>
            <div style={{ marginTop: 6 }}>
              {occ.map((o) => <BillRow key={o.id} occ={o} />)}
              {!occ.length && <div className="ink2 t-sm" style={{ padding: "16px 0" }}>Nenhuma conta neste mês. Toque num dia do calendário para cadastrar.</div>}
            </div>
            <div className="t-xs muted" style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
              <Icon name="lock" size="sm" />Toda conta nasce pendente; se vencer sem pagamento vira atrasada sozinha. Quando o pagamento aparece no extrato, ela é marcada como paga.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
