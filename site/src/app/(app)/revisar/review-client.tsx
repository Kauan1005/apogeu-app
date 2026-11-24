"use client";
import { useEffect, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
import { acceptAllRules, acceptAllSuggestions, acceptRule, createHabitRules, reopenReview, setCategory, undoCategory } from "../actions";
import { notify } from "@/components/notify";
import { CAT_COLOR, Icon, Money } from "@/components/ui";
import { dateBR, timeBR } from "@/lib/format";

export type ReviewTx = {
  id: string; occurred_at: string; has_time: boolean; amount_cents: number; description: string; description_raw: string;
  counterpart_doc_masked: string | null; payment_method: string | null; category_id: string | null; confidence: number | null;
  accounts: { name: string } | null;
};
type Cat = { id: string; slug: string; name: string; kind: string; color: string | null; icon: string | null };

export function ReviewQueue({ queue, categories, similar }: { queue: ReviewTx[]; categories: Cat[]; similar: { description: string; category_id: string; score: number }[] }) {
  const [i, setI] = useState(0);
  const [remember, setRemember] = useState(true);
  const [pending, start] = useTransition();
  const tx = queue[Math.min(i, queue.length - 1)];
  const fits = categories.filter((c) => (tx.amount_cents > 0 ? c.kind !== "expense" : c.kind !== "income")).slice(0, 8);
  const sugg = categories.find((c) => c.id === tx.category_id);
  const conf = Math.round((tx.confidence ?? 0) * 100);
  const withSugg = queue.filter((q) => q.category_id).length;

  const choose = (catId: string) => start(async () => {
    const { applied, undo } = await setCategory(tx.id, catId, remember);
    const name = categories.find((c) => c.id === catId)?.name;
    notify(applied ? `Categoria: ${name} · e mais ${applied} do mesmo destinatário` : `Categoria: ${name}`, () => undoCategory(undo));
  });

  // Deslizar no toque: para a direita confirma a sugestão, para a esquerda pula. Os botões continuam valendo.
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; id: number; active: boolean } | null>(null);
  const move = (dx: number) => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transform = dx ? `translateX(${Math.round(dx)}px)` : "";
    el.parentElement?.style.setProperty("--sw", String(Math.max(-1, Math.min(1, dx / 110))));
  };
  const onDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" || pending) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { drag.current = null; return; } // é rolagem da página
      if (!(Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5)) return;
      d.active = true;
      try { cardRef.current?.setPointerCapture(e.pointerId); } catch { /* sem captura: segue assim mesmo */ }
    }
    move(dx > 0 && !sugg ? dx * 0.25 : dx); // sem sugestão, a direita só "resiste"
  };
  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    const dx = e.clientX - d.x;
    const el = cardRef.current;
    const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (el && !calm) { el.style.transition = "transform 160ms var(--ease-out)"; setTimeout(() => { el.style.transition = ""; }, 200); }
    move(0);
    if (dx > 100 && sugg) choose(sugg.id);
    else if (dx < -100 && queue.length > 1) setI((v) => (v + 1) % queue.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pending || (e.target as HTMLElement)?.closest("input, select, textarea")) return;
      if (e.key === "Enter" && sugg) { e.preventDefault(); choose(sugg.id); }
      else if (/^[1-8]$/.test(e.key) && fits[Number(e.key) - 1]) choose(fits[Number(e.key) - 1].id);
      else if (e.key.toLowerCase() === "s") setI((v) => (v + 1) % queue.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="bento">
      <div className="grid s8" style={{ gap: 24 }}>
        {queue.length > 1 && <div className="progress" aria-hidden>{queue.slice(0, 12).map((_, k) => <i key={k} className={k < i ? "d" : ""} />)}</div>}
        <div className="swipe">
          <span className="sw-label sw-ok" aria-hidden><Icon name="check" size="sm" />Confirmar</span>
          <span className="sw-label sw-skip" aria-hidden>Pular</span>
        <div ref={cardRef} className="card grid sw-card" data-testid="review-card" style={{ gap: 22, padding: 28, opacity: pending ? 0.6 : 1 }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="row-flex" style={{ alignItems: "start" }}>
            <div className="grid" style={{ gap: 8 }}>
              <span className="t-sm muted">{i + 1} de {queue.length} · {tx.accounts?.name} · {tx.payment_method === "PIX" ? "Pix · " : ""}{dateBR(tx.occurred_at, { weekday: "long", day: "2-digit", month: "2-digit" })}{tx.has_time ? ` às ${timeBR(tx.occurred_at)}` : ""}</span>
              <div style={{ fontSize: 20, fontWeight: 500 }}>{tx.description}</div>
              <span className="raw">{tx.description_raw}{tx.counterpart_doc_masked ? ` · ${tx.counterpart_doc_masked}` : ""}</span>
            </div>
            <span className="sp" />
            <Money cents={tx.amount_cents} sign className="amount" />
          </div>
          <div className="sugg">
            <span className="ico-box" style={{ color: CAT_COLOR(sugg?.color ?? null) }}><Icon name={sugg?.icon ?? "dots"} /></span>
            <div style={{ flex: 1 }}><div className="t-sm muted">Sugestão</div><div style={{ fontWeight: 500 }}>{sugg?.name ?? "Sem sugestão"}</div></div>
            <div style={{ width: 130 }}><div className="t-xs muted" style={{ marginBottom: 6 }}>Confiança {conf}%</div><div className="bar-track" style={{ height: 4 }}><div className="bar-fill" style={{ width: `${conf}%`, background: "var(--warning)" }} /></div></div>
            {sugg && <button className="btn primary" onClick={() => choose(sugg.id)} disabled={pending}><Icon name="check" size="sm" />Confirmar<span className="mono t-xs desk-only-inline" style={{ opacity: 0.6 }}>Enter</span></button>}
          </div>
          <div>
            <div className="t-sm muted" style={{ marginBottom: 10 }}>Ou escolha outra</div>
            <div className="opts">
              {fits.map((c, k) => (
                <button key={c.id} className="opt" onClick={() => choose(c.id)} disabled={pending}>
                  <span className="dot" style={{ background: CAT_COLOR(c.color) }} />{c.name}<kbd>{k + 1}</kbd>
                </button>
              ))}
            </div>
          </div>
          <div className="row-flex t-sm ink2">
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Criar regra para este destinatário</label>
            <span className="sp" />
            <button className="btn ghost" onClick={() => setI((v) => (v + 1) % queue.length)}>Pular · S</button>
          </div>
        </div>
        </div>
        <span className="swipe-hint t-xs muted">Deslize para a direita para confirmar ou para a esquerda para pular</span>
        {i === 0 && !!similar.length && (
          <div className="card">
            <h3>Por que essa sugestão<span className="sp" /><span className="t-xs muted">transações parecidas no seu histórico</span></h3>
            <div className="list" style={{ marginTop: 8 }}>
              {similar.map((s, k) => {
                const c = categories.find((x) => x.id === s.category_id);
                return <div className="row" key={k} style={{ gridTemplateColumns: "1fr auto auto" }}><span>{s.description}</span><span className="chip"><span className="dot" style={{ background: CAT_COLOR(c?.color ?? null) }} />{c?.name}</span><span className="num muted">{Math.round(s.score * 100)}% parecida</span></div>;
              })}
            </div>
          </div>
        )}
      </div>
      <div className="grid s4" style={{ gap: 24, alignContent: "start" }}>
        <div className="card">
          <h3>Fila de revisão<span className="sp" /><span className="badge warn">{queue.length}</span></h3>
          {withSugg > 1 && (
            <button className="btn ghost accept-all" disabled={pending} onClick={() => start(async () => {
              const { ids } = await acceptAllSuggestions();
              notify(`${ids.length} sugestões aceitas`, () => reopenReview(ids));
            })}><Icon name="check" size="sm" />Aceitar as {withSugg} sugestões</button>
          )}
          <div style={{ marginTop: 8 }}>
            {queue.slice(0, 8).map((q, k) => (
              <button key={q.id} className={`q ${k === i ? "on" : ""}`} onClick={() => setI(k)}>
                <span>{q.description}</span><Money cents={q.amount_cents} sign color />
                <span className="t-xs muted">{dateBR(q.occurred_at)} · {q.accounts?.name}</span>
                <span className="t-xs" style={{ color: "var(--warning)" }}>{categories.find((c) => c.id === q.category_id)?.name ?? "Sem sugestão"}?</span>
              </button>
            ))}
          </div>
        </div>
        <div className="card desk-only-block"><h3>Atalhos</h3><div className="t-sm ink2 grid" style={{ gap: 8, marginTop: 10 }}>
          <span><span className="mono muted">Enter</span> confirmar sugestão</span><span><span className="mono muted">números</span> escolher categoria</span><span><span className="mono muted">S</span> pular</span></div></div>
      </div>
    </div>
  );
}

export function RuleSuggestions({ rules, categories }: { rules: { id: string; name: string; conditions: { value: string }[]; category_id: string }[]; categories: Cat[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h3><Icon name="tag" size="sm" />Regras sugeridas<span className="sp" />
        {rules.length > 1 && <button className="btn ghost" disabled={pending} onClick={() => start(async () => { const r = await acceptAllRules(); notify(`${r.count} regras criadas`); })}><Icon name="check" size="sm" />Criar as {rules.length}</button>}
      </h3>
      <div className="list" style={{ marginTop: 8 }}>
        {rules.map((r) => (
          <div className="row" key={r.id} style={{ gridTemplateColumns: "1fr auto auto" }}>
            <span>Toda descrição com “{r.conditions[0]?.value}” vai para <b style={{ fontWeight: 500 }}>{categories.find((c) => c.id === r.category_id)?.name}</b></span>
            <button className="btn ghost" disabled={pending} onClick={() => start(() => acceptRule(r.id, false))}>Dispensar</button>
            <button className="btn primary" disabled={pending} onClick={() => start(() => acceptRule(r.id, true))}>Criar regra</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Hábitos: destinatários que você sempre põe na mesma categoria. Um toque cria todas as regras. */
export function HabitSuggestions({ items, categories }: { items: { key: string; name: string; category_id: string; count: number }[]; categories: Cat[] }) {
  const [pending, start] = useTransition();
  if (!items.length) return null;
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h3><Icon name="check" size="sm" />Seus hábitos<span className="sp" /><span className="t-xs muted">sempre na mesma categoria</span></h3>
      <div className="list" style={{ marginTop: 8 }}>
        {items.map((h) => {
          const c = categories.find((x) => x.id === h.category_id);
          return (
            <div className="row" key={h.key} style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}>
              <span className="pot-name">{h.name}</span>
              <span className="chip"><span className="dot" style={{ background: CAT_COLOR(c?.color ?? null) }} />{c?.name ?? "Categoria"} · {h.count}×</span>
            </div>
          );
        })}
      </div>
      <button className="btn primary" disabled={pending} style={{ marginTop: 14 }} onClick={() => start(async () => {
        const r = await createHabitRules(items.map((i) => i.key));
        notify(r.ok ? `${r.created} ${r.created === 1 ? "regra criada" : "regras criadas"}${r.applied ? ` · ${r.applied} na fila resolvidas` : ""}` : r.error ?? "Não foi possível criar.");
      })}><Icon name="check" size="sm" />{items.length === 1 ? "Criar esta regra" : `Criar estas ${items.length} regras`}</button>
    </div>
  );
}
