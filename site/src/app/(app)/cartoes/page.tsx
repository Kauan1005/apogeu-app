import { createClient, requireSession } from "@/lib/supabase/server";
import { getCards } from "@/lib/phase2";
import { brl, dateBR, todayBR } from "@/lib/format";
import { Topbar } from "@/components/topbar";
import { BankTile, Icon, Money } from "@/components/ui";
import { FutureBars } from "@/components/charts";

export default async function Cartoes() {
  const s = await requireSession();
  const db = await createClient();
  const cards = await getCards(db, s.householdId);
  const today = todayBR();
  const totalFuture = new Map<string, { label: string; cents: number }>();
  for (const c of cards) for (const f of c.futureMonths) totalFuture.set(f.ym, { label: f.label, cents: (totalFuture.get(f.ym)?.cents ?? 0) + f.cents });
  // meses em ordem (cada cartão começa no próprio ciclo) e só os 6 próximos
  const futureSorted = [...totalFuture.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 6).map(([, v]) => v);

  return (
    <>
      <Topbar title="Cartões de crédito" />
      <div className="content page-in grid">
        {!cards.length && (
          <div className="card empty"><Icon name="card" size="lg" /><div style={{ fontSize: 18, fontWeight: 500 }}>Nenhum cartão conectado</div><div className="ink2">Os cartões aparecem aqui quando a conexão com o banco inclui o cartão de crédito.</div></div>
        )}
        <div className="bento">
          {cards.map((c) => {
            const last = Number(today.slice(8, 10));
            return (
              <div className={`card ${cards.length > 1 ? "s6" : "s12"}`} key={c.id}>
                <div className="row-flex">
                  <BankTile institution={c.institution} />
                  <div><div style={{ fontWeight: 500 }}>{c.name}</div><div className="t-xs muted">{[c.number_masked, c.closing_day && `fecha dia ${c.closing_day}`, c.due_day && `vence dia ${c.due_day}`].filter(Boolean).join(" · ")}</div></div>
                  <span className="sp" />{c.invoices.find((i) => i.ym === c.currentInv) && <span className="chip">Fatura de {c.invoices.find((i) => i.ym === c.currentInv)!.label}</span>}
                </div>
                {c.limit ? (
                  <>
                    <div className="row-flex" style={{ marginTop: 18 }}><span className="t-sm muted" title="Inclui a fatura atual e as parcelas futuras já compradas">Limite usado <span className="t-xs">(inclui parcelas futuras)</span></span><span className="sp" /><span className="num t-sm"><Money cents={c.used} /> <span className="muted">de <span className="money">{brl(c.limit)}</span></span></span></div>
                    <div className="bar-track" style={{ marginTop: 8, height: 8 }}><div className="bar-fill" style={{ width: `${Math.min(100, (c.used / c.limit) * 100)}%`, background: c.used / c.limit > 0.9 ? "var(--critical)" : "var(--ink-2)" }} /></div>
                  </>
                ) : null}
                <div className="stats">
                  <div className="stat"><div className="l">Fatura atual</div><div className="v"><Money cents={c.openCents} /></div>{c.nextDue && <div className="t-xs muted">vence {dateBR(c.nextDue + "T12:00:00")}</div>}</div>
                  <div className="stat"><div className="l">Melhor dia de compra</div><div className="v num">{c.best ? `dia ${c.best}` : "—"}</div><div className="t-xs muted">{c.best ? "mais prazo para pagar" : "sem dia de fechamento"}</div></div>
                  <div className="stat"><div className="l">Parcelas futuras</div><div className="v"><Money cents={c.futureTotal} /></div><div className="t-xs muted">{c.active.length} {c.active.length === 1 ? "compra parcelada" : "compras parceladas"}</div></div>
                </div>
                {c.closing_day && (
                  <>
                    <div className="cycle" aria-label="Ciclo do cartão">
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <i key={d} title={`dia ${d}`} className={`${d === c.closing_day ? "close" : d === c.due_day ? "due" : d === c.best ? "best" : ""} ${d === last ? "today" : ""}`} />
                      ))}
                    </div>
                    <div className="t-xs muted row-flex" style={{ marginTop: 8, gap: 16 }}>
                      <span><i className="dot" style={{ background: "var(--ink-2)", display: "inline-block" }} /> melhor dia</span>
                      <span><i className="dot" style={{ background: "var(--warning)", display: "inline-block" }} /> fechamento</span>
                      <span><i className="dot" style={{ background: "var(--out)", display: "inline-block" }} /> vencimento</span>
                      <span style={{ color: "var(--focus)" }}>▢ hoje</span>
                    </div>
                  </>
                )}
                <div className="list" style={{ marginTop: 16 }}>
                  {c.invoices.slice(0, 4).map((i) => (
                    <div className="row" key={i.ym} style={{ gridTemplateColumns: "1fr auto auto" }}>
                      <div><div>Fatura de {i.label}</div><div className="t-xs muted">{i.count} {i.count === 1 ? "compra" : "compras"}{i.due ? ` · vence ${dateBR(i.due + "T12:00:00")}` : ""}</div></div>
                      <span className={`st ${i.open ? "pend" : "paid"}`}>{i.open ? "Aberta" : "Fechada"}</span>
                      <Money cents={i.totalCents} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {cards.length > 0 && (
            <>
              <div className="card s7">
                <h3>Parcelas futuras · próximos 6 meses<span className="sp" /><span className="t-sm num"><Money cents={futureSorted.reduce((a, f) => a + f.cents, 0)} /></span></h3>
                <FutureBars months={futureSorted} />
              </div>
              <div className="card s5">
                <h3>Compras parceladas ativas</h3>
                <div className="list" style={{ marginTop: 6 }}>
                  {cards.flatMap((c) => c.active.map((a) => ({ ...a, card: c.name }))).map((a, k) => (
                    <div className="row" key={k} style={{ gridTemplateColumns: "1fr auto auto" }}>
                      <div><div>{a.description}</div><div className="t-xs muted">{a.card} · faltam {a.left}</div></div>
                      <span className="muted num t-sm">{a.n} de {a.total}</span><span className="num"><Money cents={a.cents} />/mês</span>
                    </div>
                  ))}
                  {!cards.some((c) => c.active.length) && <span className="ink2 t-sm">Nenhuma compra parcelada em andamento.</span>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
