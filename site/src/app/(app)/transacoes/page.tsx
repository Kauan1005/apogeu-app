import Link from "next/link";
import { createClient, createServiceClient, requireSession } from "@/lib/supabase/server";
import { householdPeople } from "@/lib/people";
import { getCategories } from "@/lib/queries";
import { monthRange } from "@/lib/format";
import { Topbar } from "@/components/topbar";
import { Icon } from "@/components/ui";
import { TxTable, type SavedFilterRow, type TxRow } from "./tx-table";
import { AutoRefresh } from "@/components/auto-refresh";

export default async function Transacoes({ searchParams }: PageProps<"/transacoes">) {
  const s = await requireSession();
  const { mes, revisar, lixeira, periodo, categoria, conta, abrir, filtro } = (await searchParams) as { mes?: string; revisar?: string; lixeira?: string; periodo?: string; categoria?: string; conta?: string; abrir?: string; filtro?: string };
  const uuidOk = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const m = monthRange(mes);
  const months = [1, 3, 6, 12].includes(Number(periodo)) ? Number(periodo) : 1;
  const first = monthRange(new Date(Date.UTC(m.year, m.month - (months - 1), 15)).toISOString().slice(0, 7));
  const db = await createClient();
  let q = db
    .from("transactions")
    .select("id, occurred_at, has_time, amount_cents, original_amount_cents, description, description_raw, counterpart_name, counterpart_doc_masked, payment_method, category_id, category_source, confidence, status, is_internal_transfer, notes, deleted_at, installment_number, total_installments, refund_pair_id, account_id, accounts(name, institution, type), transaction_tags(tags(name)), transaction_splits(id, category_id, amount_cents, note), attachments(id, filename, storage_path)")
    .eq("household_id", s.householdId)
    .gte("occurred_at", first.start.toISOString())
    .lt("occurred_at", m.end.toISOString())
    .order("occurred_at", { ascending: false })
    .limit(5000);
  q = lixeira ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
  const [{ data }, cats, { data: accOwners }, people, { data: savedRows }] = await Promise.all([
    q, getCategories(db, s.householdId),
    db.from("accounts").select("id, connections(created_by)").eq("household_id", s.householdId),
    householdPeople(createServiceClient(), s.householdId),
    db.from("saved_filters").select("id, name, filter").eq("household_id", s.householdId).eq("user_id", s.userId).order("created_at"),
  ]);
  const saved = (savedRows ?? []) as unknown as SavedFilterRow[];
  // de quem é cada conta: de quem conectou o banco (filtro "Pessoa" quando a casa tem mais de uma)
  const owners: Record<string, string> = {};
  for (const a of accOwners ?? []) { const by = (a.connections as unknown as { created_by: string | null } | null)?.created_by; if (by) owners[a.id] = by; }
  const personOpts = people.length > 1 ? people.map((p) => ({ id: p.id, label: p.id === s.userId ? "Você" : p.email })) : [];

  const rows: TxRow[] = (data ?? []).map((t) => ({
    ...(t as unknown as TxRow),
    tags: ((t.transaction_tags ?? []) as unknown as { tags: { name: string } | null }[]).map((x) => x.tags?.name).filter(Boolean) as string[],
    splits: (t.transaction_splits ?? []) as TxRow["splits"],
    attachments: (t.attachments ?? []) as TxRow["attachments"],
  }));

  return (
    <>
      <Topbar title={lixeira ? "Lixeira" : "Transações"} month={{ label: m.label, prev: m.prev, next: m.next }}>
        <span className="top-actions"><Link className="btn ghost" href={lixeira ? `/transacoes?mes=${m.key}` : `/transacoes?mes=${m.key}&lixeira=1`}><Icon name={lixeira ? "chevleft" : "trash"} size="sm" />{lixeira ? "Voltar às transações" : "Lixeira"}</Link>
        <a className="btn" href={`/api/export?format=xlsx&mes=${m.key}&periodo=${months}`}><Icon name="download" size="sm" />Excel</a>
        <a className="btn" href={`/api/export?format=csv&mes=${m.key}&periodo=${months}`}><Icon name="download" size="sm" />CSV</a></span>
        <details className="top-more"><summary className="btn ghost icon" aria-label="Mais ações"><Icon name="more" /></summary><div className="menu"><Link className="menu-item" href={lixeira ? `/transacoes?mes=${m.key}` : `/transacoes?mes=${m.key}&lixeira=1`}><Icon name={lixeira ? "chevleft" : "trash"} size="sm" />{lixeira ? "Voltar às transações" : "Lixeira"}</Link>
        <a className="menu-item" href={`/api/export?format=xlsx&mes=${m.key}&periodo=${months}`}><Icon name="download" size="sm" />Excel</a>
        <a className="menu-item" href={`/api/export?format=csv&mes=${m.key}&periodo=${months}`}><Icon name="download" size="sm" />CSV</a></div></details>
      </Topbar>
      <AutoRefresh seconds={5} />
      <div className="content page-in">
        <TxTable key={`${m.key}-${months}-${lixeira ? 1 : 0}`} rows={rows} categories={cats} householdId={s.householdId} onlyReview={!!revisar} trash={!!lixeira} monthKey={m.key} months={months}
          periodLabel={months === 1 ? m.label : `${first.label} a ${m.label}`} owners={owners} people={personOpts} initial={{ cat: uuidOk(categoria), account: uuidOk(conta), open: uuidOk(abrir), filter: saved.find((x) => x.id === uuidOk(filtro))?.filter }} saved={saved} />
      </div>
    </>
  );
}
