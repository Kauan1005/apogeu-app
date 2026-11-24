import { createClient, requireSession } from "@/lib/supabase/server";
import { getRecurring } from "@/lib/phase2";
import { brl, dateBR } from "@/lib/format";
import { Topbar } from "@/components/topbar";
import { CAT_COLOR, Icon, Money } from "@/components/ui";
import { FlagButtons } from "./flag-client";

export default async function Assinaturas() {
  const s = await requireSession();
  const db = await createClient();
  const { items, cats } = await getRecurring(db, s.householdId);
  const visible = items.filter((i) => i.status !== "ignored" && !i.stopped);
  const stopped = items.filter((i) => i.status !== "ignored" && i.stopped);
  const forgotten = visible.filter((i) => i.forgotten);
  const ignored = items.filter((i) => i.status === "ignored");
  const monthly = visible.reduce((a, i) => a + (i.cadence === "mensal" ? i.amountCents : i.cadence === "semanal" ? Math.round(i.amountCents * 4.33) : Math.round(i.amountCents / 12)), 0);
  const alerts = visible.filter((i) => i.aboveUsual || i.duplicate);

  return (
    <>
      <Topbar title="Assinaturas e recorrências" />
      <div className="content page-in grid">
        <div className="bento">
          <div className="card kpi s4"><h3><Icon name="refresh" size="sm" />Custo mensal recorrente</h3><div className="v"><Money cents={monthly} /></div><div className="d">{visible.length} {visible.length === 1 ? "cobrança detectada" : "cobranças detectadas"}</div></div>
          <div className="card kpi s4"><h3><Icon name="calendar" size="sm" />Custo em 12 meses</h3><div className="v"><Money cents={monthly * 12} /></div><div className="d">se nada mudar</div></div>
          <div className="card kpi s4"><h3><Icon name="alert" size="sm" />Pedem atenção</h3><div className="v" style={{ color: alerts.length + forgotten.length ? "var(--warning)" : undefined }}>{alerts.length + forgotten.length}</div><div className="d">{alerts.length ? `${alerts.length} ${alerts.length === 1 ? "duplicada ou mais cara" : "duplicadas ou mais caras"}` : "nenhuma duplicada"} · {forgotten.length} para confirmar</div></div>
        </div>

        <div className="card">
          <h3>Cobranças recorrentes<span className="sp" /><span className="t-xs muted">mesmo destinatário, valor parecido e intervalo regular</span></h3>
          <div className="list" style={{ marginTop: 8 }}>
            {visible.map((i) => {
              const c = cats.find((x) => x.id === i.categoryId);
              return (
                <div className="row rec-row" key={i.key} style={{ gridTemplateColumns: "36px 1fr auto auto" }}>
                  <span className="ico-box" style={{ color: CAT_COLOR(c?.color ?? null) }}><Icon name={c?.icon ?? "refresh"} /></span>
                  <div>
                    <div className="row-flex" style={{ gap: 8 }}>{i.name}
                      {i.status === "confirmed" && <span className="chip"><Icon name="check" size="sm" />Confirmada</span>}
                      {i.forgotten && <span className="chip" style={{ color: "var(--warning)" }}><Icon name="clock" size="sm" />Ainda usa? Cobrado há {i.count} {i.cadence === "anual" ? (i.count === 1 ? "ano" : "anos") : i.cadence === "semanal" ? (i.count === 1 ? "semana" : "semanas") : (i.count === 1 ? "mês" : "meses")}</span>}
                      {i.duplicate && <span className="chip" style={{ color: "var(--warning)" }}><Icon name="alert" size="sm" />Cobrada 2 vezes em {dateBR(i.duplicate.at)}</span>}
                      {i.aboveUsual && <span className="chip" style={{ color: "var(--warning)" }}><Icon name="trend" size="sm" />Acima do normal: <span className="money">{brl(i.lastCents)}</span></span>}
                    </div>
                    <div className="t-xs muted">{i.cadence} · {i.count} cobranças · {c?.name ?? "Sem categoria"} · última em {dateBR(i.lastAt)}{i.nextAt ? ` · próxima por volta de ${dateBR(i.nextAt)}` : ""}</div>
                  </div>
                  <span className="num"><Money cents={i.amountCents} />{i.cadence === "mensal" ? "/mês" : i.cadence === "semanal" ? "/sem." : "/ano"}</span>
                  <FlagButtons k={i.key} status={i.status} />
                </div>
              );
            })}
            {!visible.length && <p className="ink2 t-sm" style={{ padding: "12px 0" }}>Nenhuma cobrança recorrente encontrada ainda. Ela aparece depois de 3 cobranças parecidas.</p>}
          </div>
        </div>

        {stopped.length > 0 && (
          <div className="card">
            <h3>Pararam de cobrar<span className="sp" /><span className="t-xs muted">fora do custo mensal</span></h3>
            <div className="list" style={{ marginTop: 8 }}>
              {stopped.map((i) => (
                <div className="row rec-row no-icon" key={i.key} style={{ gridTemplateColumns: "1fr auto auto" }}>
                  <div><div>{i.name}</div><div className="t-xs muted">{i.cadence} · última cobrança em {dateBR(i.lastAt)}</div></div>
                  <span className="num muted"><Money cents={i.amountCents} /></span><FlagButtons k={i.key} status={i.status} />
                </div>
              ))}
            </div>
          </div>
        )}

        {ignored.length > 0 && (
          <div className="card">
            <h3>Ignoradas</h3>
            <div className="list" style={{ marginTop: 8 }}>
              {ignored.map((i) => (
                <div className="row" key={i.key} style={{ gridTemplateColumns: "1fr auto auto" }}>
                  <span className="muted">{i.name}</span><span className="num muted"><Money cents={i.amountCents} /></span><FlagButtons k={i.key} status={i.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
