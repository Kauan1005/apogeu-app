"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Brand } from "@/components/brand";
import { brl } from "@/lib/format";
import { readSnapshot, type StoredSnapshot } from "@/lib/offline";

const when = (t: number) => {
  const d = new Date(t);
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `hoje às ${hm}` : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hm}`;
};

/** Painel de emergência sem internet: só o que foi guardado neste aparelho. Volta sozinho ao app quando a rede voltar. */
export function OfflineView() {
  // lê o localStorage só no navegador (no servidor e na hidratação: ainda "não pronto")
  const raw = useSyncExternalStore(() => () => {}, () => { try { return `${localStorage.getItem("apogeu-snap")}|${localStorage.getItem("apogeu-last-activity")}`; } catch { return ""; } }, () => null);
  const ready = raw !== null;
  // "raw" muda quando o aparelho guarda ou apaga o resumo: é o que faz reler
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo<StoredSnapshot | null>(() => (ready ? readSnapshot() : null), [raw, ready]);
  useEffect(() => {
    const back = () => location.replace("/");
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);

  return (
    <main className="content offline">
      <div className="brand" style={{ padding: "4px 0 16px" }}><Brand /></div>
      <div className="off-banner" role="status">
        <b>Sem internet</b>
        {data ? <span> · dados de {when(data.savedAt)}</span> : null}
      </div>
      {!ready ? null : !data ? (
        <div className="card">
          <p>Não há dados guardados neste aparelho, ou ele ficou parado por mais de 2 horas e foi bloqueado.</p>
          <p className="t-sm muted" style={{ marginTop: 8 }}>Conecte-se à internet e entre de novo.</p>
        </div>
      ) : (
        <div className="bento summary">
          <div className="card kpi hero s12">
            <h3>{data.free != null ? "Livre para gastar" : "Saldo consolidado"}</h3>
            <div className="big num">{brl(data.free ?? data.balance)}</div>
            {data.free != null && data.perDay > 0 && <div className="d">até o fim do mês · ≈ {brl(data.perDay)} por dia</div>}
          </div>
          <div className="card kpi s4"><h3>Saldo consolidado</h3><div className="v num">{brl(data.balance)}</div></div>
          <div className="card kpi s4"><h3>Entradas em {data.month}</h3><div className="v num in">{brl(data.income)}</div></div>
          <div className="card kpi s4"><h3>Saídas em {data.month}</h3><div className="v num out">{brl(data.expense)}</div></div>
          {data.cats.length > 0 && (
            <div className="card s6">
              <h3>Para onde foi o dinheiro</h3>
              <div className="cat-bars">
                {data.cats.map((x) => (
                  <div className="cat-row" key={x.label}>
                    <div className="top-row"><span className="row-flex" style={{ gap: 8 }}><i className="dot" style={{ background: x.color }} />{x.label}</span><span className="num ink2">{brl(x.cents)} <span className="muted">{data.expenseTotal ? Math.round((x.cents / data.expenseTotal) * 100) : 0}%</span></span></div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(3, Math.round((x.cents / Math.max(1, data.cats[0].cents)) * 100))}%`, background: x.color }} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.bills.length > 0 && (
            <div className="card s6">
              <h3>Próximas contas</h3>
              <div className="list" style={{ marginTop: 8 }}>
                {data.bills.map((b, i) => (
                  <div className="row" key={i} style={{ gridTemplateColumns: "44px minmax(0,1fr) auto" }}>
                    <div className="ico-box num" style={{ width: 44, height: 44, display: "grid", lineHeight: 1.1, textAlign: "center" }}><b style={{ fontWeight: 500 }}>{b.day}</b><span className="t-xs muted">{b.mon}</span></div>
                    <div>{b.name}<div className="t-xs muted">{b.status}</div></div>
                    <span className="num">{brl(b.cents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 16 }}><button className="btn" onClick={() => location.reload()}>Tentar de novo</button></div>
    </main>
  );
}
