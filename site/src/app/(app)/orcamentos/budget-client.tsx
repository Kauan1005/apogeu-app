"use client";
import { useActionState, useState, useTransition } from "react";
import { addContribution, createGoal, createSuggestedBudgets, deleteBudget, deleteGoal, saveBudget } from "../actions";
import { Icon } from "@/components/ui";
import { useReauth } from "@/components/reauth";
import { MoneyInput } from "@/components/money-input";
import { parseMoney } from "@/lib/money";

type State = null | { error?: string; ok?: boolean };

export function BudgetForm({ categories }: { categories: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveBudget, null as State);
  return (
    <form action={action} className="grid" style={{ gap: 12, marginTop: 14 }}>
      <label className="f">Categoria<select className="input" name="category_id" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <div className="row-flex">
        <label className="f" style={{ flex: 1 }}>Limite mensal (R$)<MoneyInput name="limit" required /></label>
        <label className="f" style={{ width: 120 }}>Avisar em (%)<input className="input" name="alert_pct" type="number" min={50} max={100} defaultValue={80} /></label>
      </div>
      <button className="btn primary" disabled={pending} style={{ justifySelf: "start" }}><Icon name="check" size="sm" />Salvar limite</button>
      {state?.error && <span className="err" role="alert">{state.error}</span>}
      {state?.ok && <span className="ok-msg" role="status">Limite salvo.</span>}
    </form>
  );
}

export function GoalForm({ hasEmergency }: { hasEmergency: boolean }) {
  const [state, action, pending] = useActionState(createGoal, null as State);
  const [kind, setKind] = useState(hasEmergency ? "saving" : "emergency");
  return (
    <form action={action} className="row-flex" style={{ marginTop: 14, alignItems: "end" }}>
      <label className="f" style={{ flex: "1 1 160px" }}>Tipo
        <select className="input" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="emergency">Reserva de emergência</option><option value="saving">Meta de economia</option>
        </select>
      </label>
      <label className="f" style={{ flex: "2 1 200px" }}>Nome<input className="input" name="name" required defaultValue={kind === "emergency" ? "Reserva de emergência" : ""} key={kind} placeholder="Ex.: Viagem" /></label>
      {kind === "emergency"
        ? <label className="f" style={{ flex: "1 1 140px" }}>Cobrir quantos meses de gastos<input className="input" name="target_months" type="number" min={1} max={24} defaultValue={6} /></label>
        : <label className="f" style={{ flex: "1 1 140px" }}>Valor (R$)<MoneyInput name="target" required /></label>}
      <label className="f" style={{ flex: "1 1 150px" }}>Prazo (opcional)<input className="input" name="deadline" type="date" /></label>
      <button className="btn primary" disabled={pending} style={{ height: 40 }}><Icon name="plus" size="sm" />Criar meta</button>
      {state?.error && <span className="err" role="alert">{state.error}</span>}
    </form>
  );
}

export function ContributionForm({ goalId }: { goalId: string }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const send = (sign: 1 | -1) => start(async () => {
    const n = parseMoney(v);
    if (!n || n <= 0) return setErr("Informe um valor.");
    setErr("");
    await addContribution(goalId, sign * n);
    setV("");
  });
  return (
    <div className="grid" style={{ gap: 8, marginTop: 14 }}>
      <div className="row-flex" style={{ gap: 8 }}>
        <input className="input" style={{ flex: 1, minWidth: 0 }} aria-label="Valor do aporte" placeholder="Valor (R$)" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn" disabled={pending} onClick={() => send(1)}>Guardar</button>
        <button className="btn ghost" disabled={pending} onClick={() => send(-1)}>Resgatar</button>
      </div>
      {err && <span className="err" role="alert">{err}</span>}
    </div>
  );
}

export function RemoveButton({ kind, id, label }: { kind: "budget" | "goal"; id: string; label: string }) {
  const [pending, start] = useTransition();
  const reauth = useReauth("/orcamentos");
  return (
    <button className="btn ghost icon" aria-label={`Excluir ${label}`} disabled={pending} style={{ width: 32, height: 32 }}
      onClick={() => confirm(`Excluir ${label}?`) && start(async () => { reauth(await (kind === "budget" ? deleteBudget(id) : deleteGoal(id))); })}>
      <Icon name="trash" size="sm" />
    </button>
  );
}

/** Sugestões de orçamento (máximo 3): uma linha cada e um botão só. */
export function SuggestedBudgets({ items }: { items: { name: string; color: string | null; limit_cents: number; avg_cents: number }[] }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const fmt = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  return (
    <div className="bud-sugg">
      <p className="t-sm ink2">Sugestão pelos seus gastos dos últimos meses:</p>
      {items.map((g) => (
        <div className="bud-sugg-row" key={g.name}>
          <span className="row-flex" style={{ gap: 8 }}><span className="dot" style={{ background: g.color ? `var(--${g.color})` : "var(--c-rest)" }} />{g.name}</span>
          <span className="num"><span className="money">{fmt(g.limit_cents)}</span><span className="t-xs muted">/mês</span></span>
        </div>
      ))}
      <button className="btn" disabled={pending} onClick={() => start(async () => { const r = await createSuggestedBudgets(); if (r?.error) setErr(r.error); })}>
        <Icon name="check" size="sm" />{pending ? "Criando…" : items.length === 1 ? "Criar este orçamento" : `Criar estes ${items.length} orçamentos`}
      </button>
      {err && <span className="err" role="alert">{err}</span>}
    </div>
  );
}
