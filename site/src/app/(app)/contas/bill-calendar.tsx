"use client";
import { useRef, useState } from "react";
import { Icon, Money, StatusPill } from "@/components/ui";
import { notify } from "@/components/notify";
import { BillForm } from "./bills-client";

type Cal = { id: string; name: string; due_date: string; amount_cents: number; status: "pago" | "pendente" | "atrasado" };
type Cat = { id: string; name: string; slug: string };

const DOT = { pago: "var(--in)", pendente: "var(--warning)", atrasado: "var(--critical-text)" } as const;
const WEEK = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

/**
 * Calendário do mês. Tocar num dia abre um painel com as contas daquele dia e o formulário de nova conta
 * já com a data; os dias com conta mostram bolinhas (pendente, atrasada, paga) e, no computador, o nome.
 */
export function BillCalendar({ monthKey, monthLabel, cells, days, today, occ, categories }: {
  monthKey: string; monthLabel: string; cells: number[]; days: number; today: string; occ: Cal[]; categories: Cat[];
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [iso, setIso] = useState(today);

  const open = (d: number | null) => {
    setIso(d ? `${monthKey}-${String(d).padStart(2, "0")}` : today);
    dlg.current?.showModal();
  };
  const day = Number(iso.slice(8, 10));
  const dayList = occ.filter((o) => o.due_date === iso);
  const label = (s: string) => {
    const t = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  return (
    <>
      <h3>{monthLabel}<span className="sp" /><button type="button" className="btn" onClick={() => open(null)}><Icon name="plus" size="sm" />Nova conta</button></h3>
      <div className="cal">
        {WEEK.map((w) => <div key={w} className="t-xs muted cal-head">{w}</div>)}
        {cells.map((d, i) => {
          const out = d < 1 || d > days;
          if (out) return <div key={i} className="cal-cell out" aria-hidden />;
          const cellIso = `${monthKey}-${String(d).padStart(2, "0")}`;
          const list = occ.filter((o) => o.due_date === cellIso);
          const aria = list.length
            ? `Dia ${d}: ${list.map((o) => `${o.name}, ${o.status}`).join("; ")}. Abrir`
            : `Dia ${d}: sem contas. Adicionar conta`;
          return (
            <button key={i} type="button" className={`cal-cell${cellIso === today ? " today" : ""}${list.length ? " has" : ""}`} aria-label={aria} onClick={() => open(d)}>
              <span className="num t-xs cal-num">{d}</span>
              {list.length > 0 && (
                <span className="cal-dots">
                  {list.slice(0, 3).map((o) => <i key={o.id} className="cal-dot" style={{ background: DOT[o.status] }} />)}
                  {list.length > 3 && <span className="t-xs muted">+{list.length - 3}</span>}
                </span>
              )}
              {list.length > 0 && <span className="cal-name t-xs">{list[0].name}{list.length > 1 ? ` +${list.length - 1}` : ""}</span>}
            </button>
          );
        })}
      </div>
      <div className="cal-legend t-xs muted">
        <span><i className="cal-dot" style={{ background: DOT.pendente }} />pendente</span>
        <span><i className="cal-dot" style={{ background: DOT.atrasado }} />atrasada</span>
        <span><i className="cal-dot" style={{ background: DOT.pago }} />paga</span>
        <span className="cal-tip">Toque num dia para ver ou adicionar contas</span>
      </div>

      <dialog ref={dlg} className="modal cal-dlg" aria-label={`Contas do dia ${day}`} onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
        <div className="grid" style={{ gap: 16 }}>
          <div className="row-flex">
            <h3 style={{ fontSize: 18, fontWeight: 500, flex: 1 }}>{label(iso)}</h3>
            <button type="button" className="btn ghost icon" aria-label="Fechar" onClick={() => dlg.current?.close()}><Icon name="x" size="sm" /></button>
          </div>
          {dayList.length > 0 && (
            <div className="list" aria-label="Contas deste dia">
              {dayList.map((o) => (
                <div className="row" key={o.id} style={{ gridTemplateColumns: "36px minmax(0,1fr) auto auto" }}>
                  <span className="ico-box"><Icon name="receipt" /></span>
                  <div>{o.name}</div>
                  <Money cents={o.amount_cents} />
                  <StatusPill status={o.status} />
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="t-sm ink2" style={{ marginBottom: 4 }}>{dayList.length ? "Adicionar outra conta neste dia" : "Nenhuma conta neste dia. Adicionar:"}</div>
            <BillForm
              key={iso} stacked categories={categories} today={today} startsOn={iso} dueDay={day}
              onSaved={() => { dlg.current?.close(); notify(`Conta cadastrada para o dia ${day}.`); }}
            />
          </div>
        </div>
      </dialog>
    </>
  );
}
