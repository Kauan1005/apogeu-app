import { createClient, requireSession } from "@/lib/supabase/server";
import { currentNetWorth, netWorthHistory, takeSnapshot, HOLDING_CATS, type Holding, type HoldingCat } from "@/lib/patrimonio";
import { brl, dateBR } from "@/lib/format";
import { Topbar } from "@/components/topbar";
import { Icon, Money } from "@/components/ui";
import { NetWorthLine } from "@/components/charts";
import { HoldingForm, HoldingActions } from "./holdings-client";

export default async function Patrimonio() {
  const s = await requireSession();
  const db = await createClient();
  const nw = await takeSnapshot(db, s.householdId);
  const { data: vals } = await db.from("holding_values").select("holding_id, day, value_cents").eq("household_id", s.householdId).order("day", { ascending: false }).limit(2000);
  const histOf = (id: string) => (vals ?? []).filter((v) => v.holding_id === id).slice(0, 12).map((v) => ({ day: String(v.day), cents: Number(v.value_cents) }));
  const hist = await netWorthHistory(db, s.householdId, nw);
  const b = nw.breakdown;
  const prev = hist.length > 1 ? hist[hist.length - 2] : null;
  const first = hist[0];
  const delta = prev ? nw.net - prev.cents : 0;
  const assets = nw.holdings.filter((h) => h.side === "asset");
  const debts = nw.holdings.filter((h) => h.side === "liability");
  const comp = [
    { label: "Contas", cents: Math.max(0, b.cash), icon: "wallet" },
    { label: "Investimentos", cents: b.investimento, icon: "trend" },
    { label: "Bens", cents: b.bens, icon: "home" },
  ];
  const compDebt = [
    { label: "Faturas de cartão", cents: b.cartao, icon: "card" },
    { label: "Financ. e empréstimos", cents: b.dividas, icon: "landmark" },
    { label: "Parcelas a vencer", cents: b.parcelas ?? 0, icon: "calendar" },
    ...(b.cash < 0 ? [{ label: "Conta no negativo", cents: -b.cash, icon: "alert" }] : []),
  ];

  return (
    <>
      <Topbar title="Patrimônio" />
      <div className="content page-in grid">
        <div className="bento">
          <div className="card kpi s3">
            <h3><Icon name="scale" size="sm" />Patrimônio líquido</h3>
            <div className="v"><Money cents={nw.net} /></div>
            <div className="d">tudo o que tem menos tudo o que deve</div>
          </div>
          <div className="card kpi s3">
            <h3><Icon name="arrowin" size="sm" />Bens e saldos</h3>
            <div className="v"><Money cents={nw.assets} /></div>
            <div className="d">contas, investimentos e bens</div>
          </div>
          <div className="card kpi s3">
            <h3><Icon name="arrowout" size="sm" />Dívidas</h3>
            <div className="v"><Money cents={nw.liabilities} /></div>
            <div className="d">faturas, parcelas, empréstimos e financiamentos</div>
          </div>
          <div className="card kpi s3">
            <h3><Icon name="trend" size="sm" />Desde o mês passado</h3>
            <div className="v"><Money cents={delta} sign color /></div>
            <div className="d">{first && hist.length > 2 ? <>em {hist.length} meses: <Money cents={nw.net - first.cents} sign /></> : prev ? `em relação a ${prev.label}` : "a evolução aparece mês a mês"}</div>
          </div>

          <div className="card s8">
            <h3><Icon name="trend" size="sm" />Evolução do patrimônio líquido<span className="sp" />
              {hist.some((p) => p.estimated) && <span className="t-xs muted">tracejado: estimado pelas transações</span>}</h3>
            <NetWorthLine points={hist} />
          </div>
          <div className="card s4">
            <h3><Icon name="dashboard" size="sm" />Composição</h3>
            <Composition rows={comp} total={nw.assets} title="O que você tem" />
            <div style={{ height: 16 }} />
            <Composition rows={compDebt} total={nw.liabilities} title="O que você deve" />
          </div>

          <HoldingList histOf={histOf} title="Bens e investimentos" icon="home" items={assets} empty="Cadastre imóveis, veículos e investimentos que não vêm do banco. Os investimentos das contas conectadas entram sozinhos." />
          <HoldingList histOf={histOf} title="Empréstimos e financiamentos" icon="landmark" items={debts} empty="Empréstimos e financiamentos das contas conectadas entram sozinhos. Cadastre aqui os de fora (ex.: financiamento do carro em outra instituição)." />

          <div className="card s12">
            <h3><Icon name="plus" size="sm" />Adicionar bem ou dívida</h3>
            <HoldingForm />
            <p className="t-xs muted" style={{ marginTop: 12 }}>Atualize o valor quando mudar (ex.: saldo devedor depois de pagar a parcela). O patrimônio é registrado todo dia; o gráfico guarda o último valor de cada mês.</p>
          </div>
        </div>
      </div>
    </>
  );
}

function Composition({ rows, total, title }: { rows: { label: string; cents: number; icon: string }[]; total: number; title: string }) {
  return (
    <div>
      <div className="t-xs muted" style={{ margin: "10px 0 6px" }}>{title} · <span className="money">{brl(total)}</span></div>
      {rows.map((r) => (
        <div className="bud" key={r.label}>
          <div className="top-row"><span className="row-flex" style={{ gap: 8 }}><Icon name={r.icon} size="sm" />{r.label}</span><span className="num ink2"><Money cents={r.cents} /></span></div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${total ? Math.round((r.cents / total) * 100) : 0}%`, background: "var(--ink-2)" }} /></div>
        </div>
      ))}
    </div>
  );
}

function HoldingList({ title, icon, items, empty, histOf }: { title: string; icon: string; items: Holding[]; empty: string; histOf: (id: string) => { day: string; cents: number }[] }) {
  const total = items.reduce((a, h) => a + h.value_cents, 0);
  return (
    <div className="card s6">
      <h3><Icon name={icon} size="sm" />{title}<span className="sp" />{items.length > 0 && <span className="num ink2 t-sm"><Money cents={total} /></span>}</h3>
      <div className="list" style={{ marginTop: 6 }}>
        {items.map((h) => {
          const cat = HOLDING_CATS[h.category as HoldingCat];
          const d = h.details as { kind?: string; issuer?: string; installments_paid?: number; installments_total?: number; note?: string };
          const hist = histOf(h.id);
          const prevVal = hist.find((v) => v.cents !== h.value_cents);
          const sub = [
            cat?.label,
            h.source === "pluggy" ? "do banco" : "manual",
            d.kind && d.kind !== cat?.label ? d.kind : null,
            d.issuer,
            d.installments_total ? `${d.installments_paid ?? 0} de ${d.installments_total} parcelas` : null,
            h.side === "asset" && h.acquisition_cents != null ? `pago ${brl(Number(h.acquisition_cents))}${h.acquired_on ? ` em ${dateBR(h.acquired_on + "T12:00:00", { month: "2-digit", year: "numeric" })}` : ""}` : null,
            d.note,
            prevVal ? `antes ${brl(prevVal.cents)} (${dateBR(prevVal.day + "T12:00:00", { day: "2-digit", month: "2-digit", year: "2-digit" })})` : null,
            `atualizado ${dateBR(h.updated_at)}`,
          ].filter(Boolean).join(" · ");
          return (
            <div className="row hold-row" key={h.id}>
              <span className="ico-box"><Icon name={cat?.icon ?? "dots"} size="sm" /></span>
              <div style={{ minWidth: 0 }}><div>{h.name}</div><div className="t-xs muted">{sub}</div></div>
              <span className="hold-v"><Money cents={h.value_cents} /></span>
              {h.source === "manual" ? <HoldingActions h={{ id: h.id, name: h.name, category: h.category, value: h.value_cents / 100, note: d.note ?? "", hist, acq: h.acquisition_cents != null ? Number(h.acquisition_cents) / 100 : null, acqOn: h.acquired_on }} /> : <span style={{ width: 32 }} />}
            </div>
          );
        })}
        {!items.length && <p className="ink2 t-sm" style={{ padding: "12px 0" }}>{empty}</p>}
      </div>
    </div>
  );
}
