"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createBill, deleteBill, setOccurrenceCode, toggleBillPaid } from "../actions";
import { Icon, Money, StatusPill } from "@/components/ui";
import { useReauth } from "@/components/reauth";
import { dateBR } from "@/lib/format";
import { MoneyInput } from "@/components/money-input";

type Occ = { id: string; bill_id: string; name: string; due_date: string; amount_cents: number; status: "pago" | "pendente" | "atrasado"; paid_source: string | null; recurrence: string; code: string | null; payment_code: string | null; installment_no: number | null; installments_total: number | null };

export function BillRow({ occ }: { occ: Occ }) {
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(occ.payment_code ?? "");
  const paid = occ.status === "pago";
  const late = occ.status === "atrasado";
  return (
    <div className="list">
      <div className="row bill-row" style={{ gridTemplateColumns: "36px 1fr auto auto auto", opacity: pending ? 0.6 : 1 }}>
        <span className="ico-box"><Icon name="receipt" /></span>
        <div>
          <div>{occ.name}</div>
          <div className="t-xs muted">
            {paid ? "venceu" : late ? "venceu" : "vence"} {dateBR(occ.due_date + "T12:00:00")} · {occ.recurrence === "monthly" ? "todo mês" : occ.recurrence === "installments" ? `parcela ${occ.installment_no} de ${occ.installments_total}` : "única"}
            {paid && occ.paid_source === "auto" ? " · conciliada pelo extrato" : ""}
          </div>
        </div>
        <Money cents={occ.amount_cents} />
        <StatusPill status={occ.status} />
        <div className="seg" role="group" aria-label={`Situação de ${occ.name}`} style={{ gridRow: occ.status !== "pago" ? "auto" : undefined }}>
          <button type="button" className={`st ${paid ? "" : "pend"}`} aria-pressed={!paid} disabled={pending || !paid}
            onClick={() => start(() => toggleBillPaid(occ.id, false))} style={{ background: !paid ? "var(--surface-3)" : "transparent", color: !paid ? "var(--ink)" : "var(--ink-2)" }}>
            Em aberto
          </button>
          <button type="button" className="st" aria-pressed={paid} disabled={pending || paid}
            onClick={() => start(() => toggleBillPaid(occ.id, true))} style={{ background: paid ? "var(--surface-3)" : "transparent", color: paid ? "var(--ink)" : "var(--ink-2)" }}>
            Pago
          </button>
        </div>
      </div>
      {occ.status !== "pago" && (
        <div className="row-flex code-strip">
          {occ.code && !editing && (
            <>
              <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(occ.code!); setCopied(true); setTimeout(() => setCopied(false), 4000); } catch { setEditing(true); } }}>
                <Icon name={copied ? "check" : "clip"} size="sm" />{copied ? "Código copiado" : "Copiar código Pix/boleto"}
              </button>
              {copied && <span className="t-xs ink2" role="status">Abra o app do seu banco e cole em Pix copia e cola ou Pagar boleto.</span>}
            </>
          )}
          {editing ? (
            <>
              <input className="input" style={{ flex: "1 1 260px", minWidth: 0 }} aria-label={`Código de pagamento de ${occ.name} neste mês`} placeholder="Pix copia e cola ou linha digitável do boleto deste mês" value={code} maxLength={600} onChange={(e) => setCode(e.target.value)} />
              <button className="btn primary" disabled={pending} onClick={() => start(async () => { await setOccurrenceCode(occ.id, code); setEditing(false); })}>Salvar</button>
              <button className="btn ghost" onClick={() => setEditing(false)}>Cancelar</button>
            </>
          ) : (
            <button className="btn ghost" onClick={() => setEditing(true)}>{occ.payment_code ? "Trocar código do mês" : occ.code ? "Usar outro código neste mês" : "Adicionar código Pix/boleto"}</button>
          )}
          <span className="sp" /><DeleteBill billId={occ.bill_id} name={occ.name} />
        </div>
      )}
    </div>
  );
}

export function BillForm({ categories, today, startsOn, dueDay, stacked, onSaved }: {
  categories: { id: string; name: string; slug: string }[]; today: string;
  /** Data e dia já preenchidos (vindos do dia tocado no calendário). */
  startsOn?: string; dueDay?: number;
  /** Campos em coluna única (dentro do painel do calendário). */
  stacked?: boolean;
  /** Chamado uma vez quando a conta é salva. */
  onSaved?: () => void;
}) {
  const [state, action, pending] = useActionState(createBill, null as null | { error?: string; ok?: boolean });
  const [rec, setRec] = useState("monthly");
  const contas = categories.find((c) => c.slug === "contas")?.id ?? "";
  const saved = useRef(false);
  useEffect(() => {
    if (state?.ok && !saved.current) { saved.current = true; onSaved?.(); }
  }, [state, onSaved]);
  return (
    <form action={action} className={stacked ? "bill-form stacked" : "row-flex"} style={stacked ? undefined : { marginTop: 14, alignItems: "end" }}>
      <label className="f" style={{ flex: "2 1 200px" }}>Nome<input className="input" name="name" required placeholder="Ex.: Condomínio" /></label>
      <div className={stacked ? "bf-pair" : "bf-contents"}>
        <label className="f" style={{ flex: "1 1 120px" }}>Valor (R$)<MoneyInput name="amount" required /></label>
        <label className="f" style={{ flex: "0 1 110px" }}>Vence dia<input className="input" name="due_day" type="number" min={1} max={31} required defaultValue={dueDay} /></label>
      </div>
      <label className="f" style={{ flex: "1 1 140px" }}>Repetição
        <select className="input" name="recurrence" value={rec} onChange={(e) => setRec(e.target.value)}><option value="monthly">Todo mês</option><option value="installments">Parcelado</option><option value="once">Só uma vez</option></select>
      </label>
      {rec === "installments" && <label className="f" style={{ flex: "0 1 120px" }}>Nº de parcelas<input className="input" name="installments_total" type="number" min={2} max={120} required /></label>}
      {/* no painel do calendário os campos opcionais ficam recolhidos (a data já vem do dia tocado) */}
      {(() => {
        const extra = (
          <>
            <label className="f" style={{ flex: "1 1 140px" }}>{rec === "installments" ? "1ª parcela em" : "A partir de"}<input className="input" name="starts_on" type="date" defaultValue={startsOn ?? today} required /></label>
            <label className="f" style={{ flex: "1 1 160px" }}>Categoria
              <select className="input" name="category_id" defaultValue={contas}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <label className="f" style={{ flex: "1 1 180px" }}>Texto no extrato (opcional)<input className="input" name="match_keyword" placeholder="Ex.: ENEL" /></label>
            <label className="f" style={{ flex: "2 1 260px" }}>Código para pagar (opcional)<input className="input" name="payment_code" maxLength={600} placeholder="Chave Pix, Pix copia e cola ou boleto fixo" /></label>
          </>
        );
        return stacked ? <details className="more bf-more"><summary>Mais opções</summary><div className="bf-extra">{extra}</div></details> : extra;
      })()}
      <button className="btn primary" disabled={pending} style={{ height: 40 }}><Icon name="plus" size="sm" />Salvar conta</button>
      {state?.error && <span className="err" role="alert">{state.error}</span>}
      {state?.ok && <span className="ok-msg" role="status">Conta cadastrada como pendente.</span>}
    </form>
  );
}

export function DeleteBill({ billId, name }: { billId: string; name: string }) {
  const [pending, start] = useTransition();
  const reauth = useReauth("/contas");
  return (
    <button className="btn ghost" disabled={pending} onClick={() => confirm(`Excluir a conta fixa “${name}” e todas as ocorrências?`) && start(async () => { reauth(await deleteBill(billId)); })}>
      <Icon name="trash" size="sm" />Excluir conta fixa
    </button>
  );
}
