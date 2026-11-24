import Link from "next/link";
import type { ReactNode } from "react";
import { createClient, requireSession } from "@/lib/supabase/server";
import { getDashboard } from "@/lib/queries";
import { getBudgets, getCards, getRecurring } from "@/lib/phase2";
import { takeSnapshot } from "@/lib/patrimonio";
import { brl, dateBR, timeBR } from "@/lib/format";
import { Topbar } from "@/components/topbar";
import { Spark } from "@/components/spark";
import { Icon, Money, StatusPill } from "@/components/ui";
import { CashFlow, CountUp, Donut, MonthBars } from "@/components/charts";
import { suggestBudgets } from "@/lib/phase2";
import { SuggestedBudgets } from "./orcamentos/budget-client";
import { getSavingsNudge } from "@/lib/savings";
import { SavingsCard } from "./savings-card";
import { OfflineSnapshot } from "@/components/offline-snapshot";

type Tone = "crit" | "warn" | "info";
type AlertItem = { key: string; icon: string; tone: Tone; title: ReactNode; sub: ReactNode };
const toneColor = { crit: "var(--critical-text)", warn: "var(--warning)", info: "var(--ink-2)" } as const;
const toneRank = { crit: 0, warn: 1, info: 2 } as const;

function AlertRow({ a }: { a: AlertItem }) {
  return (
    <div className="row">
      <span className="ico-box" style={{ color: toneColor[a.tone] }}><Icon name={a.icon as never} size="sm" /></span>
      <div><div>{a.title}</div><div className="t-xs ink2">{a.sub}</div></div>
      <span />
    </div>
  );
}

export default async function Painel({ searchParams }: PageProps<"/">) {
  const s = await requireSession();
  const { mes, detalhes } = (await searchParams) as { mes?: string; detalhes?: string };
  const full = detalhes === "1";
  const db = await createClient();
  const [d, bud, rec, { data: conns }, { data: hh }, { data: lastDl }, nw, { data: prevSnap }, cards] = await Promise.all([
    getDashboard(db, s.householdId, mes), getBudgets(db, s.householdId, mes), getRecurring(db, s.householdId),
    db.from("connections").select("id, institution, status, error, consent_expires_at").eq("household_id", s.householdId),
    db.from("households").select("created_at, uses_app_pluggy").eq("id", s.householdId).single(),
    db.from("audit_log").select("at").eq("household_id", s.householdId).eq("table_name", "backup_download").order("at", { ascending: false }).limit(1).maybeSingle(),
    takeSnapshot(db, s.householdId),
    db.from("net_worth_snapshots").select("assets_cents, liabilities_cents").eq("household_id", s.householdId)
      .lt("month", new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7) + "-01").order("month", { ascending: false }).limit(1).maybeSingle(),
    getCards(db, s.householdId),
  ]);
  // salário que acabou de cair: sugere guardar uma parte (só no resumo do mês atual)
  const nudge = !full && (!mes || mes === d.today.slice(0, 7)) ? await getSavingsNudge(db, s.householdId) : null;
  // livre para gastar: saldo das contas − contas a pagar do mês − faturas que vencem neste mês (só no mês atual)
  const monthEnd = `${d.month.key}-31`;
  const invoicesDue = cards.filter((c) => c.openCents > 0 && (!c.nextDue || c.nextDue <= monthEnd)).reduce((a, c) => a + c.openCents, 0);
  const free = d.balance - d.openCents - invoicesDue;
  const daysLeft = d.isCurrent ? new Date(Number(d.month.key.slice(0, 4)), Number(d.month.key.slice(5, 7)), 0).getDate() - d.dayOfMonth + 1 : 0;
  const perDay = free > 0 && daysLeft > 0 ? Math.floor(free / daysLeft) : 0;
  const sugg = full && !bud.rows.length ? await suggestBudgets(db, s.householdId) : [];
  const nwDelta = prevSnap ? nw.net - (Number(prevSnap.assets_cents) - Number(prevSnap.liabilities_cents)) : null;
  // consentimento do Open Finance: vence em até 15 dias, já venceu ou a conexão está com erro
  const todayMs = new Date(d.today + "T12:00:00").getTime();
  // lembrete mensal: o cofre de backups fica no mesmo Supabase, então vale guardar uma cópia fora dele
  const month = 30 * 864e5;
  const nowMs = todayMs + 12 * 36e5; // "agora" vem da data do servidor (o render precisa ser puro)
  const backupNag = !!hh && nowMs - Date.parse(hh.created_at) > month && (!lastDl || nowMs - Date.parse(lastDl.at) > month);
  type Consent = { id: string; name: string; kind: "erro" | "vencido" | "vence"; days: number | null; error: string | null };
  const consent = (conns ?? []).flatMap((c): Consent[] => {
    // diferença em dias de calendário (fuso de São Paulo), não em horas
    const exp = c.consent_expires_at ? new Date(c.consent_expires_at).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : null;
    const days = exp ? Math.round((new Date(exp + "T12:00:00").getTime() - todayMs) / 864e5) : null;
    if (c.status === "error") return [{ id: c.id, name: c.institution ?? "Banco", kind: "erro", days, error: c.error }];
    if (days !== null && days <= 15) return [{ id: c.id, name: c.institution ?? "Banco", kind: days < 0 ? "vencido" : "vence", days, error: null }];
    return [];
  });
  const budAlerts = bud.rows.filter((r) => r.state !== "good");
  const recAlerts = rec.items.filter((i) => i.status !== "ignored" && !i.stopped && (i.aboveUsual || i.duplicate));
  const forgotten = rec.items.filter((i) => i.forgotten);
  const delta = d.prevExpense ? Math.round((d.expenseCents / d.prevExpense - 1) * 1000) / 10 : null;
  const deltaIn = d.prevIncome ? Math.round((d.incomeCents / d.prevIncome - 1) * 1000) / 10 : null;

  // ---- avisos: uma lista só, o mais grave primeiro (o resumo mostra 3; o resto fica atrás de "ver mais")
  const alerts: AlertItem[] = [
    ...consent.map((c): AlertItem => ({
      key: "c" + c.id, icon: "link", tone: c.kind === "vence" ? "warn" : "crit",
      title: c.kind === "erro" ? `Conexão com ${c.name} com erro` : c.kind === "vencido" ? `Consentimento de ${c.name} venceu` : c.days === 0 ? `Consentimento de ${c.name} vence hoje` : `Consentimento de ${c.name} vence em ${c.days} ${c.days === 1 ? "dia" : "dias"}`,
      sub: <>{c.kind === "erro" ? (c.error ?? "Os dados pararam de chegar.") : c.kind === "vencido" ? "Os dados deste banco pararam de chegar; o histórico continua aqui." : "Renove para os dados continuarem chegando (leva 30 segundos no app do banco)."} <Link className="link" href="/conexoes">Renovar em Conexões</Link></>,
    })),
    ...budAlerts.slice(0, 2).map((r): AlertItem => ({
      key: "b" + r.id, icon: "target", tone: r.state === "critical" ? "crit" : "warn",
      title: `${r.category.name}: ${r.state === "critical" ? "orçamento estourado" : `${r.pct}% do orçamento`}`,
      sub: <><span className="money">{brl(r.spent)}</span> de <span className="money">{brl(r.limit_cents)}</span>. <Link className="link" href="/orcamentos">Ver orçamentos</Link></>,
    })),
    ...d.duplicates.filter((x) => !recAlerts.some((r) => r.duplicate && r.name === x.a.description)).slice(0, 2).map((x): AlertItem => ({
      key: "d" + x.b.id, icon: "alert", tone: "warn",
      title: `Possível cobrança duplicada: ${x.a.description}`,
      sub: <>2 × <span className="money">{brl(-x.a.amount_cents)}</span> em {dateBR(x.a.occurred_at)}. <Link className="link" href="/transacoes">Ver na tabela</Link></>,
    })),
    ...recAlerts.slice(0, 2).map((i): AlertItem => ({
      key: "r" + i.key, icon: "refresh", tone: "warn",
      title: i.duplicate ? `${i.name} cobrado 2 vezes` : `${i.name} veio acima do normal`,
      sub: <>{i.duplicate ? <>Duas cobranças de <span className="money">{brl(i.duplicate.cents)}</span> em {dateBR(i.duplicate.at)}.</> : <>Última: <span className="money">{brl(i.lastCents)}</span>; o normal é <span className="money">{brl(i.amountCents)}</span>.</>} <Link className="link" href="/assinaturas">Ver assinaturas</Link></>,
    })),
    ...(forgotten.length > 0 ? [{
      key: "f", icon: "clock", tone: "warn" as Tone,
      title: `${forgotten.length} ${forgotten.length === 1 ? "assinatura para confirmar" : "assinaturas para confirmar"}`,
      sub: <>{forgotten.slice(0, 3).map((i) => i.name).join(", ")}: ainda usa? <Link className="link" href="/assinaturas">Ver assinaturas</Link></>,
    }] : []),
    ...(backupNag ? [{
      key: "bk", icon: "database", tone: "warn" as Tone,
      title: lastDl ? "Faz mais de 30 dias que você não guarda uma cópia do backup" : "Você ainda não guardou uma cópia do backup fora do Supabase",
      sub: <>Baixe o mais recente e guarde num lugar seu (HD externo, nuvem pessoal). <Link className="link" href="/ajustes#backups">Baixar em Ajustes</Link></>,
    }] : []),
    ...(d.review > 0 ? [{
      key: "rv", icon: "inbox", tone: "info" as Tone,
      title: `${d.review} ${d.review === 1 ? "transação" : "transações"} para revisar`,
      sub: <>Categoria com baixa confiança. <Link className="link" href="/revisar">Revisar agora</Link></>,
    }] : []),
    ...(d.growth ? [{
      key: "g", icon: "trend", tone: "info" as Tone,
      title: <>{d.growth.name} está <b className="out">{d.growth.pct}% acima</b> do mês anterior</>,
      sub: <><span className="money">{brl(d.growth.cents)}</span> até o dia {d.dayOfMonth} contra <span className="money">{brl(d.growth.prev)}</span>.</>,
    }] : []),
  ].sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);

  // resumo para abrir sem internet: só totais do mês atual (sem lançamentos); fica no aparelho, nunca no servidor
  const snapshot = !full && d.hasData && d.isCurrent ? {
    month: d.month.label, free, perDay, balance: d.balance, income: d.incomeCents, expense: d.expenseCents,
    cats: d.slices.slice(0, 5).map((x) => ({ label: x.label, cents: x.cents, color: x.color })), expenseTotal: d.expenseTotal,
    bills: d.openBills.slice(0, 3).map((b) => ({ name: b.name, day: b.due_date.slice(8, 10), mon: dateBR(b.due_date + "T12:00:00", { month: "short" }).replace(".", ""), cents: b.amount_cents, status: b.status === "atrasado" ? "Atrasada" : b.status === "pago" ? "Paga" : "Pendente" })),
  } : null;

  // ---- resumo simples
  const pctChange = (cur: number, prev: number, goodWhenUp: boolean) => {
    if (!prev) return null;
    const p = Math.round((cur / prev - 1) * 1000) / 10;
    if (Math.abs(p) > 300) return null;
    return <span className={(goodWhenUp ? p >= 0 : p <= 0) ? "in" : "out"}>{p >= 0 ? "▲" : "▼"} {Math.abs(p).toLocaleString("pt-BR")}%</span>;
  };
  const balanceTrend = d.points.slice(0, d.todayIdx + 1).map((p) => p.cents);
  const maxCat = Math.max(1, ...d.slices.map((x) => x.cents));
  const href = (on: boolean) => `/?${[mes ? `mes=${mes}` : "", on ? "detalhes=1" : ""].filter(Boolean).join("&")}`.replace(/\?$/, "");

  return (
    <>
      <Topbar title="Painel" month={{ label: d.month.label, prev: d.month.prev, next: d.month.next }} />
      <div className="content page-in">
        {!d.hasData ? (
          <div className="card empty">
            <Icon name="link" size="lg" />
            <div style={{ fontSize: 18, fontWeight: 500 }}>Conecte seu primeiro banco</div>
            <div className="ink2">As contas e os Pix entram sozinhos e já chegam categorizados.</div>
            <Link className="btn primary" href={hh && !hh.uses_app_pluggy ? "/comecar" : "/conexoes"}><Icon name="plus" size="sm" />{hh && !hh.uses_app_pluggy ? "Começar o passo a passo" : "Conectar banco"}</Link>
          </div>
        ) : !full ? (
          /* ------------------------------------------------ resumo: o essencial, sem poluição */
          <div className="bento summary">
            {snapshot && <OfflineSnapshot data={snapshot} />}
            <div className="card kpi hero s12" title="Saldo das contas menos as contas a pagar e as faturas que vencem neste mês">
              {d.isCurrent ? (
                <>
                  <h3><Icon name="clock" size="sm" />Livre para gastar</h3>
                  <div className="big"><Money cents={free} className={free < 0 ? "out" : ""} /></div>
                  <div className="d">{free > 0 ? <>até o fim do mês · ≈ <span className="money">{brl(perDay)}</span> por dia</> : free < 0 ? "as contas e a fatura passam do saldo" : "sem folga até o fim do mês"}</div>
                </>
              ) : (
                <>
                  <h3><Icon name="clock" size="sm" />Saldo no fim do mês</h3>
                  <div className="big"><Money cents={d.projection} /></div>
                  <div className="d">reconstruído pelo extrato</div>
                </>
              )}
            </div>

            {nudge && <SavingsCard txId={nudge.txId} description={nudge.description} amountCents={nudge.amountCents} todayYm={nudge.todayYm} goals={nudge.goals} />}

            <div className="card kpi s4">
              <h3><Icon name="wallet" size="sm" />Saldo consolidado</h3>
              <div className="v"><CountUp cents={d.balance} /></div>
              <Spark values={balanceTrend} label="Saldo dia a dia neste mês" />
              <div className="d">contas correntes e poupança</div>
            </div>
            <div className="card kpi s4">
              <h3><Icon name="arrowin" size="sm" />Entradas no mês</h3>
              <div className="v"><Money cents={d.incomeCents} className="in" /></div>
              <Spark values={d.months.map((m) => m.inCents)} color="var(--in-mark)" label="Entradas dos últimos 6 meses" />
              <div className="d">{pctChange(d.incomeCents, d.prevIncome, true) ?? "neste mês"}{deltaIn !== null && Math.abs(deltaIn) <= 300 ? " vs. mês passado" : ""}</div>
            </div>
            <div className="card kpi s4">
              <h3><Icon name="arrowout" size="sm" />Saídas no mês</h3>
              <div className="v"><Money cents={d.expenseCents} className="out" /></div>
              <Spark values={d.months.map((m) => m.outCents)} color="var(--out-mark)" label="Saídas dos últimos 6 meses" />
              <div className="d">{pctChange(d.expenseCents, d.prevExpense, false) ?? "neste mês"}{delta !== null && Math.abs(delta) <= 300 ? " vs. mês passado" : ""}</div>
            </div>

            <div className="card s6">
              <h3>Para onde foi o dinheiro<span className="sp" /><Link className="t-sm link" href="/transacoes">Ver transações</Link></h3>
              <div className="cat-bars">
                {d.slices.slice(0, 5).map((x) => (
                  <div className="cat-row" key={x.label}>
                    <div className="top-row"><span className="row-flex" style={{ gap: 8 }}><i className="dot" style={{ background: x.color }} />{x.label}</span>
                      <span className="num ink2"><Money cents={x.cents} /> <span className="muted">{d.expenseTotal ? Math.round((x.cents / d.expenseTotal) * 100) : 0}%</span></span></div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(3, Math.round((x.cents / maxCat) * 100))}%`, background: x.color }} /></div>
                  </div>
                ))}
                {!d.slices.length && <span className="ink2 t-sm">Nenhuma saída neste mês.</span>}
              </div>
            </div>
            <div className="card s6">
              <h3><Icon name="calendar" size="sm" />Próximas contas<span className="sp" /><Link className="t-sm link" href="/contas">Ver contas</Link></h3>
              <div style={{ marginTop: 8 }}>
                {d.openBills.slice(0, 3).map((b) => (
                  <div className="list" key={b.id}>
                    <div className="row due-row" style={{ gridTemplateColumns: "48px minmax(0, 1fr) auto auto" }}>
                      <div className="ico-box num" style={{ width: 44, height: 44, display: "grid", lineHeight: 1.1, textAlign: "center" }}>
                        <b style={{ fontWeight: 500 }}>{b.due_date.slice(8, 10)}</b><span className="t-xs muted">{dateBR(b.due_date + "T12:00:00", { month: "short" }).replace(".", "")}</span>
                      </div>
                      <div>{b.name}</div>
                      <Money cents={b.amount_cents} />
                      <StatusPill status={b.status} />
                    </div>
                  </div>
                ))}
                {!d.openBills.length && <div className="ink2 t-sm" style={{ padding: "12px 0" }}>Nenhuma conta em aberto. <Link className="link" href="/contas">Cadastrar contas fixas</Link></div>}
              </div>
            </div>

            <div className="card s12">
              <h3><Icon name="bell" size="sm" />Atenção{alerts.length > 0 && <span className="badge" style={{ marginLeft: 4 }}>{alerts.length}</span>}</h3>
              <div className="list" style={{ marginTop: 6 }}>
                {alerts.slice(0, 3).map((a) => <AlertRow key={a.key} a={a} />)}
                {!alerts.length && <span className="ink2 t-sm">Tudo em ordem por aqui.</span>}
              </div>
              {alerts.length > 3 && (
                <details className="more">
                  <summary>Ver mais {alerts.length - 3}</summary>
                  <div className="list">{alerts.slice(3).map((a) => <AlertRow key={a.key} a={a} />)}</div>
                </details>
              )}
            </div>

            <div className="s12 more-link"><Link className="link" href={href(true)}>Ver gráficos e detalhes <span aria-hidden>→</span></Link></div>
          </div>
        ) : (
          /* ------------------------------------------------ detalhes: gráficos e listas completas */
          <div className="bento">
            <div className="s12 more-link" style={{ marginBottom: -8 }}><Link className="link" href={href(false)}><span aria-hidden>←</span> Voltar ao resumo</Link></div>
            <div className="card kpi s3">
              <h3><Icon name="wallet" size="sm" />Saldo consolidado</h3>
              <div className="v"><CountUp cents={d.balance} /></div>
              <div className="d">contas correntes e poupança</div>
            </div>
            <div className="card kpi s3">
              <h3><Icon name="arrowin" size="sm" />Entradas no mês</h3>
              <div className="v"><Money cents={d.incomeCents} className="in" /></div>
              <div className="d">{deltaIn === null || Math.abs(deltaIn) > 300 ? "sem transferências entre suas contas" : <><span className={deltaIn >= 0 ? "in" : "out"}>{deltaIn >= 0 ? "▲" : "▼"} {Math.abs(deltaIn).toLocaleString("pt-BR")}%</span> vs. mês anterior até o dia {d.dayOfMonth}</>}</div>
            </div>
            <div className="card kpi s3">
              <h3><Icon name="arrowout" size="sm" />Saídas no mês</h3>
              <div className="v"><Money cents={d.expenseCents} className="out" /></div>
              <div className="d">
                {delta === null ? "sem base no mês anterior" : <><span className={delta > 0 ? "out" : "in"}>{delta > 0 ? "▲ +" : "▼ −"}<span className="money">{brl(Math.abs(d.expenseCents - d.prevExpense)).replace(/^[−-] /, "")}</span>{Math.abs(delta) <= 300 ? ` (${Math.abs(delta).toLocaleString("pt-BR")}%)` : ""}</span> vs. mês anterior até o dia {d.dayOfMonth}</>}
              </div>
            </div>
            {d.isCurrent ? (
              <div className="card kpi s3" title="Saldo das contas menos as contas a pagar e as faturas que vencem neste mês">
                <h3><Icon name="clock" size="sm" />Livre para gastar</h3>
                <div className="v"><Money cents={free} className={free < 0 ? "out" : ""} /></div>
                <div className="d">{free > 0 ? <>até o fim do mês · ≈ <span className="money">{brl(perDay)}</span> por dia</> : free < 0 ? "as contas e a fatura passam do saldo" : "sem folga até o fim do mês"}</div>
              </div>
            ) : (
              <div className="card kpi s3">
                <h3><Icon name="clock" size="sm" />Saldo no fim do mês</h3>
                <div className="v"><Money cents={d.projection} /></div>
                <div className="d">reconstruído pelo extrato</div>
              </div>
            )}

            <div className="card s8">
              <h3>Fluxo de caixa · saldo diário</h3>
              <div className="leg-inline"><span><i className="sw" style={{ background: "var(--ink)" }} />Realizado</span>{d.isCurrent && <span><i className="sw" style={{ border: "1.5px dashed var(--ink-2)" }} />Projetado</span>}</div>
              <CashFlow points={d.points} todayIndex={d.todayIdx} monthLabel={d.month.label} />
            </div>
            <div className="card s4">
              <h3>Gastos por categoria<span className="sp" /><span className="t-sm muted">{d.month.label}</span></h3>
              <div style={{ display: "grid", placeItems: "center", marginTop: 14 }}><Donut data={d.slices} total={d.expenseTotal} /></div>
              <div className="legend" style={{ marginTop: 16 }}>
                {d.slices.map((x) => (
                  <div className="row" key={x.label}>
                    <i className="dot" style={{ background: x.color }} /><span>{x.label}</span><Money cents={x.cents} />
                    <span className="pct num">{d.expenseTotal ? Math.round((x.cents / d.expenseTotal) * 100) : 0}%</span>
                  </div>
                ))}
                {!d.slices.length && <span className="ink2 t-sm">Nenhuma saída neste mês.</span>}
              </div>
            </div>

            <div className="card s6">
              <h3>Entradas × saídas · 6 meses</h3>
              <div className="leg-inline"><span><i className="sw" style={{ background: "var(--in-mark)" }} />Entradas</span><span><i className="sw" style={{ background: "var(--out-mark)" }} />Saídas</span></div>
              <MonthBars months={d.months} />
              {d.isCurrent && <div className="t-xs muted" style={{ marginTop: 6 }}>* mês atual parcial</div>}
            </div>
            <div className="card s6" style={{ alignSelf: "start" }}>
              <h3><Icon name="target" size="sm" />Orçamentos<span className="sp" /><Link className="t-sm link" href="/orcamentos">Ver todos</Link></h3>
              <div style={{ marginTop: 8 }}>
                {bud.rows.slice(0, 4).map((r) => (
                  <div className="bud" key={r.id}>
                    <div className="top-row"><span>{r.category.name}</span><span className="num ink2"><Money cents={r.spent} /> <span className="muted">/ <span className="money">{brl(r.limit_cents)}</span></span></span></div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, r.pct)}%`, background: r.state === "good" ? "var(--ink-2)" : `var(--${r.state})` }} /></div>
                    {r.state === "good" ? <span className="t-xs muted">{r.pct}% usado</span>
                      : <span className="pill-status t-xs" style={{ color: r.state === "critical" ? "var(--critical-text)" : "var(--warning)" }}><Icon name="alert" size="sm" />{r.state === "critical" ? <>Estourou <span className="money">{brl(r.spent - r.limit_cents)}</span></> : `${r.pct}% usado`}</span>}
                  </div>
                ))}
                {!bud.rows.length && (sugg.length ? <SuggestedBudgets items={sugg} /> : <div className="ink2 t-sm" style={{ padding: "12px 0" }}>Nenhum limite definido. <Link className="link" href="/orcamentos">Criar orçamento</Link></div>)}
              </div>
            </div>
            <div className="card s5">
              <h3><Icon name="calendar" size="sm" />A vencer<span className="sp" /><Link className="t-sm link" href="/contas">Ver contas</Link></h3>
              <div style={{ marginTop: 8 }}>
                {d.openBills.map((b) => (
                  <div className="list" key={b.id}>
                    <div className="row due-row" style={{ gridTemplateColumns: "48px minmax(0, 1fr) auto auto" }}>
                      <div className="ico-box num" style={{ width: 44, height: 44, display: "grid", lineHeight: 1.1, textAlign: "center" }}>
                        <b style={{ fontWeight: 500 }}>{b.due_date.slice(8, 10)}</b><span className="t-xs muted">{dateBR(b.due_date + "T12:00:00", { month: "short" }).replace(".", "")}</span>
                      </div>
                      <div>{b.name}</div>
                      <Money cents={b.amount_cents} />
                      <StatusPill status={b.status} />
                    </div>
                  </div>
                ))}
                {!d.openBills.length && <div className="ink2 t-sm" style={{ padding: "12px 0" }}>Nenhuma conta em aberto. <Link className="link" href="/contas">Cadastrar contas fixas</Link></div>}
              </div>
            </div>

            <div className="card s4" style={{ order: 2, alignSelf: "start" }}>
              <h3><Icon name="scale" size="sm" />Patrimônio líquido<span className="sp" /><Link className="t-sm link" href="/patrimonio">Ver</Link></h3>
              <div style={{ fontSize: 28, fontWeight: 500, marginTop: 12 }}><Money cents={nw.net} /></div>
              <div className="t-sm muted" style={{ marginTop: 4 }}>{nwDelta !== null ? <><Money cents={nwDelta} sign color /> desde o mês passado</> : "a evolução aparece mês a mês"}</div>
              <div className="list" style={{ marginTop: 12 }}>
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span className="ink2">Bens e saldos</span><Money cents={nw.assets} /></div>
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span className="ink2">Dívidas</span><Money cents={nw.liabilities} /></div>
              </div>
            </div>
            <div className="card s8" style={{ order: 2 }}>
              <h3>Maiores gastos do mês</h3>
              <div className="list" style={{ marginTop: 6 }}>
                {d.top.map((t) => (
                  <div className="row" key={t.id}>
                    <span className="ico-box"><Icon name={t.category?.icon ?? "dots"} /></span>
                    <div><div>{t.description}</div><div className="t-xs muted">{t.category?.name ?? "Sem categoria"} · {t.accounts?.name} · {dateBR(t.occurred_at)}{t.has_time ? ` ${timeBR(t.occurred_at)}` : ""}</div></div>
                    <Money cents={t.amount_cents} color />
                  </div>
                ))}
                {!d.top.length && <span className="ink2 t-sm">Nenhuma saída neste mês.</span>}
              </div>
            </div>
            <div className="card s7">
              <h3><Icon name="bell" size="sm" />Avisos do mês</h3>
              <div className="list" style={{ marginTop: 6 }}>
                {alerts.map((a) => <AlertRow key={a.key} a={a} />)}
                {!alerts.length && <span className="ink2 t-sm">Tudo em ordem por aqui.</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
