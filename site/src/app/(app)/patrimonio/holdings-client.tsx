"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { deleteHolding, saveHolding } from "../actions";
import { Icon } from "@/components/ui";
import { useReauth } from "@/components/reauth";
import { MoneyInput } from "@/components/money-input";

type State = null | { error?: string; ok?: boolean };
type H = { id: string; name: string; category: string; value: number; note: string; acq: number | null; acqOn: string | null; hist?: { day: string; cents: number }[] };
const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ASSETS = ["investimento", "imovel", "veiculo", "outro_bem"];

const OPTIONS = [
  ["Bens", [["investimento", "Investimento"], ["imovel", "Imóvel"], ["veiculo", "Veículo"], ["outro_bem", "Outro bem"]]],
  ["Dívidas", [["financiamento", "Financiamento"], ["emprestimo", "Empréstimo"], ["outra_divida", "Outra dívida"]]],
] as const;

export function HoldingForm({ h, onDone }: { h?: H; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (p: State, f: FormData) => {
    const r = await saveHolding(p, f);
    if (r?.ok) { formRef.current?.reset(); onDone?.(); }
    return r;
  }, null as State);
  const formRef = useRef<HTMLFormElement>(null);
  const [cat, setCat] = useState(h?.category ?? "imovel");
  const asset = ASSETS.includes(cat);
  return (
    <form ref={formRef} action={action} className="row-flex" style={{ marginTop: 14, alignItems: "end" }}>
      {h && <input type="hidden" name="id" value={h.id} />}
      <label className="f" style={{ flex: "1 1 150px" }}>Tipo
        <select className="input" name="category" value={cat} onChange={(e) => setCat(e.target.value)}>
          {OPTIONS.map(([g, opts]) => <optgroup key={g} label={g}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}
        </select>
      </label>
      <label className="f" style={{ flex: "2 1 200px" }}>Nome<input className="input" name="name" required minLength={2} maxLength={80} defaultValue={h?.name} placeholder="Ex.: Apartamento, Carro, Tesouro Selic" /></label>
      <label className="f" style={{ flex: "1 1 140px" }}>Valor atual (R$)<MoneyInput name="value" required defaultValue={h?.value} /></label>
      {asset && <>
        <label className="f" style={{ flex: "1 1 150px" }}>Valor pago (R$, para o IR)<MoneyInput name="acquisition" defaultValue={h?.acq} placeholder="custo de aquisição" /></label>
        <label className="f" style={{ flex: "1 1 140px" }}>Data da compra<input className="input" name="acquired_on" type="date" defaultValue={h?.acqOn ?? ""} /></label>
      </>}
      <label className="f" style={{ flex: "2 1 180px" }}>Observação (opcional)<input className="input" name="note" maxLength={200} defaultValue={h?.note} placeholder="Ex.: valor da tabela FIPE" /></label>
      <button className="btn primary" disabled={pending} style={{ height: 40 }}><Icon name="check" size="sm" />{h ? "Salvar" : "Adicionar"}</button>
      {h && <button type="button" className="btn ghost" style={{ height: 40 }} onClick={onDone}>Cancelar</button>}
      {state?.error && <span className="err" role="alert">{state.error}</span>}
      {state?.ok && !h && <span className="ok-msg" role="status">Salvo.</span>}
    </form>
  );
}

export function HoldingActions({ h }: { h: H }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const reauth = useReauth("/patrimonio");
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (editing) dlg.current?.showModal(); else dlg.current?.close(); }, [editing]);
  return (
    <span className="row-flex hold-a" style={{ gap: 4 }}>
      <button className="btn ghost icon" aria-label={`Editar ${h.name}`} onClick={() => setEditing(true)}><Icon name="edit" size="sm" /></button>
      <button className="btn ghost icon" aria-label={`Excluir ${h.name}`} disabled={pending}
        onClick={() => confirm(`Excluir ${h.name}?`) && start(async () => { reauth(await deleteHolding(h.id)); })}>
        <Icon name="trash" size="sm" />
      </button>
      <dialog ref={dlg} className="modal" onClose={() => setEditing(false)} aria-label={`Editar ${h.name}`}>
        <h3 style={{ margin: 0 }}>Editar {h.name}</h3>
        {editing && <HoldingForm h={h} onDone={() => setEditing(false)} />}
        {editing && (h.hist?.length ?? 0) > 1 && (
          <div style={{ marginTop: 18 }}>
            <div className="t-xs muted" style={{ marginBottom: 6 }}>Histórico de valores</div>
            <div className="list">
              {h.hist!.map((v) => (
                <div className="row" key={v.day} style={{ gridTemplateColumns: "1fr auto", padding: "6px 0" }}>
                  <span className="t-sm ink2">{v.day.split("-").reverse().join("/")}</span><span className="num t-sm money">{money(v.cents)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </dialog>
    </span>
  );
}
