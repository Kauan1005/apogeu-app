"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState, type FilterFn,
} from "@tanstack/react-table";
import { addAttachment, deleteFilter, saveFilter, setCategory, setNotes, setTags, splitTransaction, trashTransaction, undoCategory } from "../actions";
import { notify } from "@/components/notify";
import { BankTile, CAT_COLOR, Icon, Money } from "@/components/ui";
import { brl, dateBR, normalizeDesc, timeBR } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useReauth } from "@/components/reauth";
import { parseMoney } from "@/lib/money";

export type TxRow = {
  id: string; occurred_at: string; has_time: boolean; amount_cents: number; original_amount_cents: number | null;
  description: string; description_raw: string; counterpart_name: string | null; counterpart_doc_masked: string | null;
  payment_method: string | null; category_id: string | null; category_source: string; confidence: number | null;
  status: "ok" | "review" | "canceled"; is_internal_transfer: boolean; refund_pair_id: string | null; notes: string | null; deleted_at: string | null;
  installment_number: number | null; total_installments: number | null; account_id: string;
  accounts: { name: string; institution: string | null; type: string } | null;
  tags: string[]; splits: { id: string; category_id: string | null; amount_cents: number; note: string | null }[];
  attachments: { id: string; filename: string; storage_path: string }[];
};
type Cat = { id: string; slug: string; name: string; kind: string; color: string | null; icon: string | null; label?: string };
type Group = "dia" | "mes" | "categoria" | "conta";
export type FilterValue = { q: string; account: string; cat: string; person: string; review: boolean; min: number; group: Group; months: 1 | 3 | 6 | 12 };
export type SavedFilterRow = { id: string; name: string; filter: FilterValue };

const search: FilterFn<TxRow> = (row, _id, value: string) => {
  const q = normalizeDesc(value);
  const r = row.original;
  return normalizeDesc(`${r.description} ${r.description_raw} ${r.counterpart_name ?? ""} ${r.notes ?? ""} ${r.tags.join(" ")} ${brl(r.amount_cents)}`).includes(q);
};

export function TxTable({ rows, categories, householdId, onlyReview, trash, monthKey, months = 1, periodLabel = "", owners = {}, people = [], initial = {}, saved = [] }: { initial?: { cat?: string; account?: string; open?: string; filter?: FilterValue }; saved?: SavedFilterRow[]; rows: TxRow[]; categories: Cat[]; householdId: string; onlyReview: boolean; trash: boolean; monthKey: string; months?: number; periodLabel?: string; owners?: Record<string, string>; people?: { id: string; label: string }[] }) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([{ id: "occurred_at", desc: true }]);
  const [q, setQ] = useState(initial.filter?.q ?? "");
  const [account, setAccount] = useState(initial.filter?.account ?? initial.account ?? "");
  const [person, setPerson] = useState(initial.filter?.person ?? "");
  const [cat, setCat] = useState(initial.filter?.cat ?? initial.cat ?? "");
  const [review, setReview] = useState(onlyReview || !!initial.filter?.review);
  const [min, setMin] = useState(initial.filter?.min ? String(initial.filter.min).replace(".", ",") : "");
  const minC = Math.round((parseFloat(min.replace(",", ".")) || 0) * 100);
  const [naming, setNaming] = useState(false);
  const [fname, setFname] = useState("");
  const [fpending, fstart] = useTransition();
  const [group, setGroup] = useState<Group>(initial.filter?.group ?? (months > 1 ? "mes" : "dia"));
  const [editing, setEditing] = useState<TxRow | null>(() => (initial.open ? rows.find((r) => r.id === initial.open) ?? null : null));
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accounts = useMemo(() => [...new Map(rows.map((r) => [r.account_id, r.accounts?.name ?? "Conta"])).entries()], [rows]);

  const data = useMemo(
    () => rows.filter((r) => (!person || owners[r.account_id] === person) && (!minC || Math.abs(r.amount_cents) >= minC) && (!account || r.account_id === account) && (!cat || r.category_id === cat || r.splits.some((s) => s.category_id === cat)) && (!review || r.status === "review")),
    [rows, account, cat, review, person, owners, minC],
  );

  const columns = useMemo<ColumnDef<TxRow>[]>(() => [
    { id: "occurred_at", accessorKey: "occurred_at", header: "Data", sortingFn: "datetime" },
    { id: "description", accessorKey: "description", header: "Descrição", filterFn: search },
    { id: "category", accessorFn: (r) => catById.get(r.category_id ?? "")?.name ?? "", header: "Categoria" },
    { id: "account", accessorFn: (r) => r.accounts?.name ?? "", header: "Conta" },
    { id: "amount_cents", accessorKey: "amount_cents", header: "Valor" },
  ], [catById]);

  const table = useReactTable({
    data, columns,
    state: { sorting, globalFilter: q },
    onSortingChange: setSorting,
    onGlobalFilterChange: setQ,
    globalFilterFn: search,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const visible = table.getRowModel().rows.map((r) => r.original);

  // filtros salvos: o filtro de agora, o que já está salvo igual a ele e como aplicar um salvo
  const current: FilterValue = { q: q.trim(), account, cat, person, review, min: minC / 100, group, months: ([1, 3, 6, 12].includes(months) ? months : 1) as FilterValue["months"] };
  const hasFilter = !!(current.q || account || cat || person || review || minC);
  const sameFilter = (a: FilterValue, b: FilterValue) => a.q === b.q && a.account === b.account && a.cat === b.cat && a.person === b.person && a.review === b.review && a.min === b.min && a.group === b.group && a.months === b.months;
  const matching = saved.find((sf) => sameFilter(sf.filter, current));
  const apply = (f: FilterValue, id: string) => {
    if (f.months !== months) { router.push(`/transacoes?mes=${monthKey}&periodo=${f.months}&filtro=${id}`); return; } // outro período recarrega os dados
    setQ(f.q); setAccount(f.account); setCat(f.cat); setPerson(f.person); setReview(f.review); setGroup(f.group);
    setMin(f.min ? String(f.min).replace(".", ",") : "");
  };
  const suggest = () => [current.q, catById.get(cat)?.name, minC ? `acima de ${brl(minC).replace("R$ ", "R$")}` : "", review ? "a revisar" : ""].filter(Boolean).join(" · ").slice(0, 40);

  const groups = useMemo(() => {
    const key = (r: TxRow) =>
      group === "dia" ? new Date(r.occurred_at).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
        : group === "mes" ? new Date(r.occurred_at).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7)
        : group === "conta" ? r.accounts?.name ?? "Conta" : catById.get(r.category_id ?? "")?.name ?? "Sem categoria";
    const m = new Map<string, TxRow[]>();
    for (const r of visible) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()];
  }, [visible, group, catById]);

  const sumOut = visible.filter((r) => r.amount_cents < 0 && !r.is_internal_transfer).reduce((a, r) => a - r.amount_cents, 0);
  const sumIn = visible.filter((r) => r.amount_cents > 0 && !r.is_internal_transfer).reduce((a, r) => a + r.amount_cents, 0);
  const sortHead = (id: string, label: string, right = false, extra = "") => {
    const col = table.getColumn(id)!;
    const dir = col.getIsSorted();
    return (
      <th className={`${right ? "r" : ""} ${extra}`.trim() || undefined} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
        <button className="th-btn" onClick={col.getToggleSortingHandler()}>{label}{dir && <Icon name={dir === "asc" ? "chevdown" : "chevdown"} size="sm" />}</button>
      </th>
    );
  };

  return (
    <>
      <div className="toolbar">
        <label className="field" style={{ minWidth: 260 }}>
          <Icon name="search" size="sm" />
          <input aria-label="Buscar" placeholder="Buscar descrição, valor, tag…" value={q} onChange={(e) => setQ(e.target.value)} style={{ background: "transparent", border: 0, color: "var(--ink)", outline: "none", flex: 1, font: "inherit" }} />
        </label>
        {people.length > 1 && (
          <select className="input" aria-label="Pessoa" value={person} onChange={(e) => setPerson(e.target.value)} style={{ height: 36 }}>
            <option value="">Pessoa: todas</option>{people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        )}
        <select className="input" aria-label="Conta" value={account} onChange={(e) => setAccount(e.target.value)} style={{ height: 36 }}>
          <option value="">Conta: todas</option>{accounts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <select className="input" aria-label="Categoria" value={cat} onChange={(e) => setCat(e.target.value)} style={{ height: 36 }}>
          <option value="">Categoria: todas</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.label ?? c.name}</option>)}
        </select>
        <label className="field min-field" title="Só lançamentos de valor igual ou maior (entrada ou saída)">
          <span className="t-xs muted">Acima de R$</span>
          <input aria-label="Valor mínimo" inputMode="decimal" placeholder="0" value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d,.]/g, "").slice(0, 12))}
            style={{ background: "transparent", border: 0, color: "var(--ink)", outline: "none", width: 70, font: "inherit", fontSize: 14 }} />
        </label>
        {trash && <span className="t-xs muted" style={{ flexBasis: "100%" }}>Itens na lixeira são apagados de vez após 30 dias.</span>}
        {!trash && (
          <button className="chip" aria-pressed={review} onClick={() => setReview(!review)} style={{ color: review ? "var(--warning)" : undefined, cursor: "pointer" }}>
            <Icon name="alert" size="sm" />Só a revisar · {rows.filter((r) => r.status === "review").length} {periodLabel ? `em ${periodLabel.toLowerCase()}` : "no período"}
          </button>
        )}
        <span className="sp" />
        <select className="input" aria-label="Período" value={months} style={{ height: 36 }}
          onChange={(e) => router.push(`/transacoes?mes=${monthKey}&periodo=${e.target.value}${trash ? "&lixeira=1" : ""}`)}>
          <option value={1}>Só este mês</option><option value={3}>Últimos 3 meses</option><option value={6}>Últimos 6 meses</option><option value={12}>Últimos 12 meses</option>
        </select>
        <div className="seg" role="group" aria-label="Agrupar por">
          {(["dia", "mes", "categoria", "conta"] as Group[]).map((g) => (
            <button key={g} className={group === g ? "on" : ""} aria-pressed={group === g} onClick={() => setGroup(g)} style={{ height: 30, padding: "0 12px", borderRadius: 7, border: 0, background: group === g ? "var(--surface-3)" : "transparent", color: group === g ? "var(--ink)" : "var(--ink-2)", font: "500 13px var(--font)", cursor: "pointer" }}>
              {{ dia: "Dia", mes: "Mês", categoria: "Categoria", conta: "Conta" }[g]}
            </button>
          ))}
        </div>
      </div>

      {!trash && (saved.length > 0 || hasFilter) && (
        <div className="saved-bar" role="group" aria-label="Filtros salvos">
          {saved.map((sf) => {
            const on = matching?.id === sf.id;
            return (
              <span key={sf.id} className={`chip saved${on ? " on" : ""}`}>
                <button type="button" aria-pressed={on} onClick={() => apply(sf.filter, sf.id)}>{sf.name}</button>
                <button type="button" className="x" aria-label={`Excluir o filtro ${sf.name}`} disabled={fpending} onClick={() => fstart(async () => { await deleteFilter(sf.id); router.refresh(); })}>×</button>
              </span>
            );
          })}
          {hasFilter && !matching && !naming && <button type="button" className="chip" onClick={() => { setFname(suggest()); setNaming(true); }}><Icon name="plus" size="sm" />Salvar este filtro</button>}
          {naming && (
            <form className="row-flex" style={{ gap: 8 }} onSubmit={(e) => {
              e.preventDefault();
              fstart(async () => {
                const r = await saveFilter(fname, current);
                if ("error" in r && r.error) { notify(r.error); return; }
                setNaming(false); notify("Filtro salvo."); router.refresh();
              });
            }}>
              <input className="input" aria-label="Nome do filtro" value={fname} maxLength={40} onChange={(e) => setFname(e.target.value)} style={{ height: 36, width: 220 }} />
              <button className="btn primary" disabled={fpending || !fname.trim()}>Salvar</button>
              <button type="button" className="btn ghost" onClick={() => setNaming(false)}>Cancelar</button>
            </form>
          )}
        </div>
      )}

      <div className="sheet" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              {sortHead("occurred_at", "Data")}
              {sortHead("description", "Descrição")}
              {sortHead("category", "Categoria")}
              {sortHead("account", "Conta", false, "col-acct")}
              <th className="col-tags">Tags</th>
              <th className="col-class">Classificação</th>
              {sortHead("amount_cents", "Valor", true)}
              <th aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {groups.map(([g, list]) => (
              <GroupRows key={g} label={group === "dia" ? dateBR(g + "T12:00:00", { weekday: "long", day: "2-digit", month: "2-digit" }) : group === "mes" ? dateBR(g + "-15T12:00:00", { month: "long", year: "numeric" }) : g} list={list}
                categories={categories} catById={catById} onOpen={setEditing} trash={trash} byDay={group === "dia"} />
            ))}
            {!visible.length && <tr><td colSpan={8} className="ink2" style={{ textAlign: "center", padding: 32 }}>Nenhuma transação encontrada.</td></tr>}
          </tbody>
        </table>
        <div className="foot-bar">
          <span>{visible.length} de {rows.length} · {periodLabel || "no mês"}</span><span className="sp" />
          <span className="num">Saídas <Money cents={-sumOut} className="out" /></span>
          <span className="num">Entradas <Money cents={sumIn} className="in" /></span>
        </div>
      </div>
      {editing && <TxDialog tx={editing} categories={categories} householdId={householdId} onClose={() => setEditing(null)} />}
    </>
  );
}

function GroupRows({ label, list, categories, catById, onOpen, trash, byDay = false }: { label: string; list: TxRow[]; categories: Cat[]; catById: Map<string, Cat>; onOpen: (t: TxRow) => void; trash: boolean; byDay?: boolean }) {
  const total = list.filter((r) => !r.is_internal_transfer).reduce((a, r) => a + r.amount_cents, 0);
  return (
    <>
      <tr className="group"><td colSpan={8}><span className="group-line"><span>{label.charAt(0).toUpperCase() + label.slice(1)}</span><Money cents={total} sign /></span></td></tr>
      {list.map((r) => <Row key={r.id} r={r} categories={categories} catById={catById} onOpen={onOpen} trash={trash} byDay={byDay} />)}
    </>
  );
}

function Row({ r, categories, catById, onOpen, trash, byDay = false }: { r: TxRow; categories: Cat[]; catById: Map<string, Cat>; onOpen: (t: TxRow) => void; trash: boolean; byDay?: boolean }) {
  const [pending, start] = useTransition();
  const [remember, setRemember] = useState(true);
  const c = catById.get(r.category_id ?? "");
  const muted = r.status === "canceled" || r.is_internal_transfer;
  const fits = categories.filter((x) => (r.amount_cents > 0 ? x.kind !== "expense" : x.kind !== "income"));
  return (
    <>
      <tr className={`tx-row ${muted ? "muted-row" : ""}`} style={{ opacity: pending ? 0.6 : 1 }}
        onClick={(e) => { if (!trash && !(e.target as HTMLElement).closest("select,input,button,label,a")) onOpen(r); }}>
        <td className="num c-date" style={{ width: 96 }}>{byDay ? (r.has_time ? timeBR(r.occurred_at) : <span className="muted">—</span>) : <>{dateBR(r.occurred_at)}<div className="t-xs muted">{r.has_time ? timeBR(r.occurred_at) : "—"}</div></>}</td>
        <td className="desc c-desc">
          <span className="desc-wrap">
            <span className="avatar" aria-hidden="true">{initials(r.counterpart_name ?? r.description)}</span>
            <span className="desc-text">
              <b>{r.description}{r.total_installments ? <span className="inst" title="Parcela">{r.installment_number}/{r.total_installments}</span> : null}{r.refund_pair_id ? <span className="inst" title="Gasto e devolução do mesmo valor se anulam: não contam em gastos nem em entradas">anulado</span> : null}</b>
              <span className="raw-line">{r.description_raw}{r.counterpart_doc_masked ? ` · ${r.counterpart_doc_masked}` : ""}</span>
            </span>
          </span>
        </td>
        <td className="c-cat">
          {r.splits.length ? (
            <span className="chip">Dividida em {r.splits.length}</span>
          ) : trash ? (
            <span className="cat-cell"><span className="dot" style={{ background: CAT_COLOR(c?.color ?? null) }} />{c?.label ?? c?.name ?? "Sem categoria"}</span>
          ) : (
            <span className="cat-cell">
              <span className="dot" style={{ background: CAT_COLOR(c?.color ?? null) }} />
              <select aria-label={`Categoria de ${r.description}`} value={r.category_id ?? ""} disabled={pending || trash}
                onChange={(e) => { const name = fits.find((x) => x.id === e.target.value); start(async () => { const { applied, undo } = await setCategory(r.id, e.target.value, remember); notify(`Categoria: ${name?.label ?? name?.name ?? ""}${applied ? ` (e mais ${applied})` : ""}`, () => undoCategory(undo)); }); }}>
                {!r.category_id && <option value="">Sem categoria</option>}
                {fits.map((x) => <option key={x.id} value={x.id}>{x.label ?? x.name}</option>)}
              </select>
            </span>
          )}
          {r.status === "review" && !trash && (
            <label className="t-xs ink2" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />lembrar destinatário
            </label>
          )}
        </td>
        <td className="ink2 col-acct"><span className="acct"><BankTile institution={r.accounts?.institution ?? null} />{r.accounts?.name}{r.payment_method === "PIX" && <span className="muted" title="Pix"><Icon name="pix" size="sm" /></span>}</span></td>
        <td className="col-tags">{r.tags.map((t) => <span key={t} className="tagx" style={{ marginRight: 4 }}>{t}</span>)}</td>
        <td className="col-class"><Classif r={r} /></td>
        <td className="r num c-val" style={{ width: 150 }}>
          {r.status === "canceled" ? (<><span className="strike money">{brl(r.original_amount_cents ?? 0)}</span><span className="muted money">R$ 0,00 (cancelada)</span></>)
            : <Money cents={r.amount_cents} sign color={!muted && r.amount_cents > 0} className={muted ? "muted" : ""} />}
        </td>
        <td className={`c-act${trash ? " keep" : ""}`} style={{ width: 96, whiteSpace: "nowrap" }}>
          {r.attachments.length > 0 && <span className="muted" title="Comprovante"><Icon name="clip" size="sm" /></span>}
          {trash ? (
            <button className="btn ghost" style={{ height: 32 }} onClick={() => start(async () => { await trashTransaction(r.id, true); })}>Restaurar</button>
          ) : (
            <button className="btn ghost icon" aria-label={`Detalhes de ${r.description}`} onClick={() => onOpen(r)}><Icon name="more" /></button>
          )}
        </td>
      </tr>
      {r.splits.map((s) => (
        <tr className="sub" key={s.id}>
          <td /><td className="ink2" style={{ paddingLeft: 28 }}>↳ {s.note || "Parte"}</td>
          <td><span className="cat-cell"><span className="dot" style={{ background: CAT_COLOR(catById.get(s.category_id ?? "")?.color ?? null) }} />{catById.get(s.category_id ?? "")?.name}</span></td>
          <td className="col-acct" /><td className="col-tags" /><td className="col-class" /><td className="r num"><Money cents={s.amount_cents} sign /></td><td />
        </tr>
      ))}
    </>
  );
}

/** Iniciais do estabelecimento ou pessoa (duas letras), para reconhecer a linha de relance. */
function initials(name: string) {
  const words = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));
  const pick = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "•").slice(0, 2);
  return pick.toUpperCase();
}

function Classif({ r }: { r: TxRow }) {
  if (r.status === "canceled") return <span className="conf muted"><Icon name="x" size="sm" />Cancelada no banco</span>;
  if (r.refund_pair_id) return <span className="conf muted" title="Gasto e devolução do mesmo valor se anulam"><Icon name="transfer" size="sm" />Devolvido · anulado</span>;
  if (r.is_internal_transfer) return <span className="conf muted"><Icon name="transfer" size="sm" />Fora dos gastos</span>;
  if (r.status === "review") return <span className="conf" style={{ color: "var(--warning)" }}><Icon name="alert" size="sm" />Revisar · {Math.round((r.confidence ?? 0) * 100)}%</span>;
  const label: Record<string, string> = { user: "Você", rule: "Regra", payee: "Destinatário", provider: "Banco", similarity: "Semelhança", transfer: "Transferência", none: "—" };
  return <span className="conf muted">{["user", "rule", "payee"].includes(r.category_source) && <Icon name="check" size="sm" />}{label[r.category_source] ?? r.category_source}{r.category_source === "similarity" || r.category_source === "provider" ? ` · ${Math.round((r.confidence ?? 0) * 100)}%` : ""}</span>;
}

/** Detalhes: anotação, tags, divisão, comprovante e lixeira. */
function TxDialog({ tx, categories, householdId, onClose }: { tx: TxRow; categories: Cat[]; householdId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [notes, setN] = useState(tx.notes ?? "");
  const [tags, setT] = useState(tx.tags.join(", "));
  const [parts, setParts] = useState(tx.splits.length ? tx.splits.map((s) => ({ category_id: s.category_id ?? "", amount: (Math.abs(s.amount_cents) / 100).toFixed(2).replace(".", ","), note: s.note ?? "" })) : []);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const reauth = useReauth("/transacoes");
  const sign = tx.amount_cents < 0 ? -1 : 1;
  const fits = categories.filter((x) => (tx.amount_cents > 0 ? x.kind !== "expense" : x.kind !== "income"));
  const partsCents = parts.reduce((a, p) => a + Math.round((parseMoney(p.amount) || 0) * 100), 0);

  const save = () => start(async () => {
    setErr("");
    // confere a divisão antes de salvar qualquer coisa (nada fica salvo pela metade)
    if (parts.length && partsCents !== Math.abs(tx.amount_cents)) { setErr(`A soma das partes (${brl(partsCents)}) precisa ser igual ao valor da transação (${brl(Math.abs(tx.amount_cents))}).`); return; }
    if (parts.some((p) => !p.category_id || !(parseMoney(p.amount) > 0))) { setErr("Cada parte precisa de uma categoria e de um valor maior que zero."); return; }
    const r = await splitTransaction(tx.id, parts.map((p) => ({ category_id: p.category_id, amount_cents: sign * Math.round(parseMoney(p.amount) * 100), note: p.note || undefined })));
    if (r.error) { setErr(r.error); return; }
    await setNotes(tx.id, notes);
    await setTags(tx.id, tags.split(","));
    onClose();
  });

  const upload = async (f: File) => {
    const path = `${householdId}/${tx.id}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await createClient().storage.from("attachments").upload(path, f, { upsert: false });
    if (error) return setErr("Falha no envio: use PNG, JPG, WEBP ou PDF até 10 MB.");
    await addAttachment(tx.id, path, f.name);
  };
  const openFile = async (p: string) => {
    const { data } = await createClient().storage.from("attachments").createSignedUrl(p, 60);
    if (data) window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <dialog ref={(el) => { ref.current = el; if (el && !el.open) el.showModal(); }} className="modal" onClose={onClose} aria-labelledby="tx-title">
      <div className="grid" style={{ gap: 16 }}>
        <div className="row-flex"><b id="tx-title" style={{ fontWeight: 500, fontSize: 17 }}>{tx.description}</b><span className="sp" /><Money cents={tx.amount_cents} sign /></div>
        <div className="t-xs muted" style={{ marginTop: -8 }}>
          {dateBR(tx.occurred_at, { day: "2-digit", month: "2-digit", year: "numeric" })}{tx.has_time ? ` às ${timeBR(tx.occurred_at)}` : ""} · {tx.accounts?.name ?? "Conta"}{tx.counterpart_doc_masked ? ` · ${tx.counterpart_doc_masked}` : ""}
          <div className="mono" style={{ marginTop: 4, overflowWrap: "anywhere" }}>{tx.description_raw}</div>
        </div>
        <label className="f">Anotação<textarea className="input" rows={2} value={notes} onChange={(e) => setN(e.target.value)} /></label>
        <label className="f">Tags (separadas por vírgula)<input className="input" value={tags} onChange={(e) => setT(e.target.value)} /></label>
        <div className="grid" style={{ gap: 8 }}>
          <div className="row-flex"><span className="t-sm ink2">Dividir em categorias</span><span className="sp" />
            <button className="btn ghost" onClick={() => setParts([...parts, { category_id: fits[0]?.id ?? "", amount: "", note: "" }])}><Icon name="split" size="sm" />Adicionar parte</button></div>
          {parts.map((p, i) => (
            <div className="row-flex" key={i}>
              <select className="input" value={p.category_id} onChange={(e) => setParts(parts.map((x, k) => (k === i ? { ...x, category_id: e.target.value } : x)))}>{fits.map((c) => <option key={c.id} value={c.id}>{c.label ?? c.name}</option>)}</select>
              <input className="input" style={{ width: 110 }} inputMode="decimal" placeholder="Valor" value={p.amount} onChange={(e) => setParts(parts.map((x, k) => (k === i ? { ...x, amount: e.target.value.replace(",", ".") } : x)))} />
              <input className="input" style={{ flex: 1 }} placeholder="Nota" value={p.note} onChange={(e) => setParts(parts.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)))} />
              <button className="btn ghost icon" aria-label="Remover parte" onClick={() => setParts(parts.filter((_, k) => k !== i))}><Icon name="x" size="sm" /></button>
            </div>
          ))}
          {parts.length > 0 && <span className={`t-xs ${partsCents === Math.abs(tx.amount_cents) ? "muted" : "err"}`}>Soma {brl(partsCents)} de {brl(Math.abs(tx.amount_cents))}</span>}
        </div>
        <div className="grid" style={{ gap: 8 }}>
          <span className="t-sm ink2">Comprovantes</span>
          {tx.attachments.map((a) => <button key={a.id} className="link" style={{ textAlign: "left", background: "none", border: 0, cursor: "pointer" }} onClick={() => openFile(a.storage_path)}>{a.filename}</button>)}
          <label className="btn" style={{ justifySelf: "start", cursor: "pointer" }}>
            <Icon name="clip" size="sm" />Anexar comprovante
            <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => e.target.files?.[0] && start(() => upload(e.target.files![0]))} />
          </label>
          <span className="t-xs muted">PNG, JPG, WEBP ou PDF, até 10 MB.</span>
        </div>
        {err && <span className="err" role="alert">{err}</span>}
        <div className="row-flex dialog-actions">
          <button className="btn ghost" onClick={() => start(async () => { const r = await trashTransaction(tx.id); if (!reauth(r)) { onClose(); notify("Movida para a lixeira", () => trashTransaction(tx.id, true)); } })}><Icon name="trash" size="sm" />Mover para a lixeira</button>
          <span className="sp" />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={pending} onClick={save}><Icon name="check" size="sm" />Salvar</button>
        </div>
      </div>
    </dialog>
  );
}
