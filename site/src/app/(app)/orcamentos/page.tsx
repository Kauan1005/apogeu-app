import { createClient, requireSession } from "@/lib/supabase/server";
import { bankColor } from "@/lib/banks";
import { getBudgets, getCofrinhos, getGoals, suggestBudgets } from "@/lib/phase2";
import { brl, dateBR } from "@/lib/format";
import { Topbar } from "@/components/topbar";
import { CAT_COLOR, Icon, Money } from "@/components/ui";
import { BudgetForm, ContributionForm, GoalForm, RemoveButton, SuggestedBudgets } from "./budget-client";
import { CofrinhoList, GoalPots, type PotOption } from "./cofrinhos-client";

export default async function Orcamentos({ searchParams }: PageProps<"/orcamentos">) {
  const s = await requireSession();
  const { mes } = (await searchParams) as { mes?: string };
  const db = await createClient();
  const pots = await getCofrinhos(db, s.householdId);
  const potMap = new Map(pots.groups.flatMap((g) => g.items.map((i) => [`${i.kind}:${i.id}`, i.cents] as const)));
  // meta ligada a cofrinhos usa a cor do banco do primeiro cofrinho (a barra se reconhece de relance)
  const potBank = new Map<string, string>(pots.groups.flatMap((g) => g.items.map((i) => [`${i.kind}:${i.id}`, g.bank] as const)));
  const potOptions: PotOption[] = pots.groups.flatMap((g) => g.items.map((i) => ({ ref: `${i.kind}:${i.id}`, label: `${g.bank} · ${i.name}`, cents: i.cents })));
  const [b, goals] = await Promise.all([getBudgets(db, s.householdId, mes), getGoals(db, s.householdId, potMap, { names: new Map(pots.groups.flatMap((g) => g.items.filter((i) => i.kind === "pot").map((i) => [`pot:${i.id}`, i.name] as const))), yield30: pots.yield30, totalCents: pots.total })]);
  const expenseCats = b.cats.filter((c) => c.kind === "expense");
  const sugg = b.rows.length ? [] : await suggestBudgets(db, s.householdId);
  const totalLimit = b.rows.reduce((a, r) => a + r.limit_cents, 0);
  const totalSpent = b.rows.reduce((a, r) => a + r.spent, 0);
  const label = { good: "", warning: "Perto do limite", critical: "Estourou" } as const;

  return (
    <>
      <Topbar title="Orçamentos e metas" month={{ label: b.month.label, prev: b.month.prev, next: b.month.next }} />
      <div className="content page-in grid">
        <div className="bento">
          <div className="card s7">
            <h3><Icon name="target" size="sm" />Orçamento do mês<span className="sp" />
              {b.rows.length > 0 && <span className="t-sm ink2 num"><span className="money">{brl(totalSpent)}</span> de <span className="money">{brl(totalLimit)}</span></span>}</h3>
            <div style={{ marginTop: 8 }}>
              {b.rows.map((r) => (
                <div className="bud" key={r.id}>
                  <div className="top-row">
                    <span className="row-flex" style={{ gap: 8 }}><span className="dot" style={{ background: CAT_COLOR(r.category.color) }} />{r.category.name}</span>
                    <span className="num ink2"><Money cents={r.spent} /> <span className="muted">/ <span className="money">{brl(r.limit_cents)}</span></span></span>
                  </div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, r.pct)}%`, background: r.state === "good" ? "var(--ink-2)" : `var(--${r.state})` }} /></div>
                  <div className="row-flex t-xs" style={{ gap: 12 }}>
                    {r.state !== "good"
                      ? <span className="pill-status" style={{ color: r.state === "critical" ? "var(--critical-text)" : "var(--warning)" }}><Icon name="alert" size="sm" />{label[r.state]} · {r.pct}%{r.state === "critical" && <> · passou <span className="money">{brl(r.spent - r.limit_cents)}</span></>}</span>
                      : <span className="muted">{r.pct}% usado</span>}
                    {r.projected > r.limit_cents && r.state === "good" && <span className="muted">no ritmo atual fecha o mês em <span className="money">{brl(r.projected)}</span></span>}
                    <span className="sp" /><RemoveButton kind="budget" id={r.id} label={`orçamento de ${r.category.name}`} />
                  </div>
                </div>
              ))}
              {!b.rows.length && (sugg.length ? <SuggestedBudgets items={sugg} /> : <p className="ink2 t-sm" style={{ padding: "12px 0" }}>Defina um limite por categoria. O painel avisa quando chegar perto.</p>)}
            </div>
          </div>
          <div className="card s5">
            <h3><Icon name="plus" size="sm" />Limite por categoria</h3>
            <BudgetForm categories={expenseCats.map((c) => ({ id: c.id, name: c.label }))} />
            <p className="t-xs muted" style={{ marginTop: 12 }}>Vale para todos os meses. Salvar de novo a mesma categoria atualiza o limite.</p>
          </div>

          <div className="card s12">
            <h3><Icon name="wallet" size="sm" />Cofrinhos<span className="sp" />{pots.groups.length > 0 && <span className="t-sm num"><Money cents={pots.total} /></span>}</h3>
            {pots.yield30 > 0 && <p className="t-xs muted" style={{ marginTop: 6 }}>Rendeu <Money cents={pots.yield30} /> nos últimos 30 dias</p>}
            {pots.groups.length ? <CofrinhoList groups={pots.groups} hiddenCount={pots.hiddenCount} /> : <p className="ink2 t-sm" style={{ marginTop: 10 }}>Nenhum cofrinho encontrado. Aparecem aqui a poupança e as aplicações dos bancos conectados.</p>}
          </div>

          {goals.map((g) => (
            <div className="card s4" key={g.id}>
              <h3><Icon name={g.kind === "emergency" ? "lock" : "flag"} size="sm" />{g.name}<span className="sp" /><RemoveButton kind="goal" id={g.id} label={`meta ${g.name}`} /></h3>
              <div style={{ fontSize: 24, fontWeight: 500, marginTop: 12 }}><Money cents={g.saved} /></div>
              <div className="t-sm muted">de <span className="money">{brl(g.target)}</span>{g.kind === "emergency" && g.target_months ? ` · ${g.target_months} meses de gastos (média de ${brl(g.avgMonthly)})` : ""}</div>
              <div className="bar-track" style={{ marginTop: 12, height: 8 }}><div className="bar-fill" style={{ width: `${g.pct}%`, background: g.pct >= 100 ? "var(--in-mark)" : bankColor(...(g.pot_refs ?? []).map((r: string) => potBank.get(r))) ?? "var(--ink-2)" }} /></div>
              <div className="t-xs muted" style={{ marginTop: 8 }}>
                {g.pct}% {g.deadline ? `· até ${dateBR(g.deadline + "T12:00:00", { day: "2-digit", month: "2-digit", year: "numeric" })}` : ""}
                {g.perMonth ? <> · guardar <span className="money">{brl(g.perMonth)}</span>/mês</> : ""}
              </div>
              {g.eta && <div className="t-xs ink2" style={{ marginTop: 6 }} title="Média dos últimos 3 meses">no ritmo atual: {g.eta}</div>}
              {g.linked ? <div className="t-xs muted" style={{ marginTop: 10 }}>O progresso vem do saldo dos cofrinhos.</div> : <ContributionForm goalId={g.id} />}
              <GoalPots goalId={g.id} options={potOptions} selected={g.pot_refs ?? []} />
            </div>
          ))}
          <div className={`card ${goals.length % 3 === 0 ? "s12" : goals.length % 3 === 1 ? "s8" : "s4"}`}>
            <h3><Icon name="flag" size="sm" />Nova meta</h3>
            <GoalForm hasEmergency={goals.some((g) => g.kind === "emergency")} />
          </div>
        </div>
      </div>
    </>
  );
}
