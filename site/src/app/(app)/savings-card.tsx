"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";
import { brl } from "@/lib/format";
import { resolveSavings } from "./actions";
import type { NudgeGoal } from "@/lib/savings";

const PCTS = [5, 10, 15, 20];

/** Mês/ano da previsão: faltam (alvo − guardado) ao ritmo mensal dado; null se não há ritmo ou passa de 10 anos. */
function etaLabel(g: NudgeGoal, extraPerMonth: number, todayYm: string): string | null {
  const pace = g.pace + extraPerMonth;
  if (pace <= 0) return null;
  const months = Math.ceil((g.target - g.saved) / pace);
  if (months > 120) return null;
  const y = Number(todayYm.slice(0, 4)), m = Number(todayYm.slice(5, 7));
  const dt = new Date(Date.UTC(y, m - 1 + months, 15));
  return `${dt.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "")}/${dt.getUTCFullYear()}`;
}

export function SavingsCard({ txId, description, amountCents, todayYm, goals }: { txId: string; description: string; amountCents: number; todayYm: string; goals: NudgeGoal[] }) {
  const router = useRouter();
  const [pct, setPct] = useState(10);
  const [goalId, setGoalId] = useState(goals[0]?.id ?? "");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const cents = Math.round((amountCents * pct) / 100);
  const g = goals.find((x) => x.id === goalId);
  const before = g ? g.eta : null;
  const after = g ? etaLabel(g, cents, todayYm) : null;

  const run = (action: "saved" | "dismissed") => start(async () => {
    setErr("");
    const r = await resolveSavings(txId, action, pct, action === "saved" ? g?.id ?? null : null);
    if (r && "error" in r && r.error) return setErr(r.error);
    router.refresh();
  });

  return (
    <div className="card s12 savings" aria-label="Aporte sugerido">
      <h3><Icon name="trend" size="sm" />Entrou {description}: {brl(amountCents)}</h3>
      <p className="sv-lead">Que tal guardar <b className="num">{brl(cents)}</b> todo mês?</p>
      <div className="sv-pcts" role="radiogroup" aria-label="Quanto guardar">
        {PCTS.map((p) => <button key={p} type="button" role="radio" aria-checked={pct === p} className={pct === p ? "on" : ""} onClick={() => setPct(p)}>{p}%</button>)}
      </div>
      {goals.length > 1 && (
        <label className="f" style={{ maxWidth: 320 }}>Para qual meta
          <select className="input" value={goalId} onChange={(e) => setGoalId(e.target.value)}>{goals.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </label>
      )}
      {g ? (
        <p className="t-sm ink2" data-testid="effect">
          {g.name}: {after ? <>chega em <b>{after}</b></> : "sem previsão ainda"}{before ? <span className="muted"> (hoje: {before})</span> : <span className="muted"> (hoje: sem previsão)</span>}
          {g.linked ? <span className="muted"> · guarde no cofrinho; o progresso vem do saldo</span> : null}
        </p>
      ) : (
        <p className="t-sm ink2">Você ainda não tem metas. <Link className="link" href="/orcamentos">Criar uma meta</Link> para ver quando chega.</p>
      )}
      {err && <span className="err" role="alert">{err}</span>}
      <div className="row-flex" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn primary" disabled={pending} onClick={() => run("saved")}>{g && !g.linked ? `Registrar ${brl(cents)}` : "Já guardei"}</button>
        <button className="btn ghost" disabled={pending} onClick={() => run("dismissed")}>Agora não</button>
      </div>
    </div>
  );
}
