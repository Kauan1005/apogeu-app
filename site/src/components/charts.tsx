"use client";
import { useEffect, useRef, useState } from "react";
import { brl } from "@/lib/format";

// Gráficos em SVG próprio, seguindo a skill dataviz: marcas finas, grade discreta,
// legenda sempre presente com 2+ séries, cores validadas para daltonismo e tooltip ao passar o mouse.

export type Slice = { label: string; cents: number; color: string };

/**
 * Largura real do gráfico em pixels: o desenho usa essa largura no viewBox, então os textos ficam
 * sempre no tamanho escrito (antes encolhiam junto com o gráfico no celular).
 */
function useChartWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => { const cw = Math.round(e.contentRect.width); if (cw > 0) setW(Math.max(300, cw)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Donut({ data, total }: { data: Slice[]; total: number }) {
  const R = 78, r = 54, cx = 90, cy = 90, gap = 0.012;
  let a0 = -Math.PI / 2;
  const paths = data.map((d) => {
    const a1 = a0 + (d.cents / (total || 1)) * Math.PI * 2;
    const s = a0 + gap, e = Math.max(s, a1 - gap), big = e - s > Math.PI ? 1 : 0;
    // coordenadas arredondadas: servidor e navegador calculam cos/sin com diferenças na última casa (erro de hidratação)
    const p = (rad: number, ang: number) => [+(cx + rad * Math.cos(ang)).toFixed(3), +(cy + rad * Math.sin(ang)).toFixed(3)];
    const [x1, y1] = p(R, s), [x2, y2] = p(R, e), [x3, y3] = p(r, e), [x4, y4] = p(r, s);
    a0 = a1;
    return <path key={d.label} d={`M${x1} ${y1}A${R} ${R} 0 ${big} 1 ${x2} ${y2}L${x3} ${y3}A${r} ${r} 0 ${big} 0 ${x4} ${y4}Z`} fill={d.color}><title>{`${d.label}: ${brl(d.cents)}`}</title></path>;
  });
  return (
    <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="Gastos por categoria">
      {total > 0 ? paths : <circle cx={cx} cy={cy} r={66} fill="none" stroke="var(--surface-3)" strokeWidth={24} />}
      <text x="90" y="84" textAnchor="middle" fill="var(--muted)" fontSize="11">Gasto no mês</text>
      <text x="90" y="103" textAnchor="middle" fill="var(--ink)" fontSize={brl(total).length > 12 ? 13 : 15} fontWeight="500" className="num money">{brl(total)}</text>
    </svg>
  );
}

/** Saldo diário: linha cheia até hoje, tracejada na projeção. Crosshair + tooltip no hover. */
export function CashFlow({ points, todayIndex, monthLabel }: { points: { day: number; cents: number }[]; todayIndex: number; monthLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useChartWidth(760);
  const H = 300, L = 84, B = 28, T = 12;
  if (!points.length) return null;
  const vals = points.map((p) => p.cents);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { hi += 100000; lo -= 100000; }
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const n = points.length;
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - 12);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks: number[] = []; for (let v = lo; v <= hi + 1; v += step) ticks.push(v);
  const path = (from: number, to: number) => points.slice(from, to + 1).map((p, k) => `${k ? "L" : "M"}${x(from + k).toFixed(1)} ${y(p.cents).toFixed(1)}`).join("");
  const ti = Math.min(Math.max(todayIndex, 0), n - 1);
  const area = `${path(0, ti)}L${x(ti)} ${H - B}L${x(0)} ${H - B}Z`;
  const h = hover ?? null;
  const useMil = hi - lo >= 200000; // eixo inteiro no mesmo formato
  const short = (v: number) => (v === 0 ? "R$ 0" : useMil ? `${v < 0 ? "−" : ""}R$ ${(Math.abs(v) / 100000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : brl(v));

  return (
    <div className="chart" ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Saldo diário de ${monthLabel}`}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - 12)) * (n - 1)))));
        }}
        onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".10" /><stop offset="1" stopColor="#f0efec" stopOpacity="0" /></linearGradient></defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - 12} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
            <text x={L - 8} y={y(v) + 4} fill="var(--muted)" fontSize="13" textAnchor="end" className="num money">{short(v)}</text>
          </g>
        ))}
        {[0, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75), n - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} fill="var(--muted)" fontSize="13" textAnchor="middle" className="num">{String(points[i].day).padStart(2, "0")}</text>
        ))}
        <line x1={L} x2={W - 12} y1={H - B} y2={H - B} stroke="var(--axis)" />
        <path d={area} fill="url(#cf)" />
        <path d={path(0, ti)} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
        {ti < n - 1 && <path d={path(ti, n - 1)} fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="5 5" />}
        {ti < n - 1 && <><line x1={x(ti)} x2={x(ti)} y1={T} y2={H - B} stroke="var(--axis)" strokeDasharray="2 4" /><text x={x(ti) + 6} y={T + 12} fill="var(--muted)" fontSize="13">hoje</text></>}
        {h !== null && <><line x1={x(h)} x2={x(h)} y1={T} y2={H - B} stroke="var(--border-strong)" /><circle cx={x(h)} cy={y(points[h].cents)} r="5" fill="var(--ink)" stroke="var(--surface-1)" strokeWidth="2" /></>}
        <rect x={L} y={T} width={W - L - 12} height={H - T - B} fill="transparent" />
      </svg>
      <DataTable caption={`Saldo diário de ${monthLabel}`} head={["Dia", "Saldo", "Tipo"]}
        rows={points.map((p, i) => [String(p.day).padStart(2, "0"), brl(p.cents), i > ti ? "projetado" : "realizado"])} />
      {h !== null && (
        <div className="tooltip" style={{ left: `${Math.min(80, (x(h) / W) * 100 + 1.5)}%`, top: 8 }}>
          <div className="muted">Dia {String(points[h].day).padStart(2, "0")}{h > ti ? " · projeção" : ""}</div>
          <div className="num money" style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>{brl(points[h].cents)}</div>
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Entradas × saídas por mês (barras agrupadas, polaridade verde/vermelho validada). */
export function MonthBars({ months }: { months: { label: string; inCents: number; outCents: number; partial?: boolean }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useChartWidth(600);
  const H = 300, L = 70, B = 30, T = 10;
  const max = Math.max(1, ...months.flatMap((m) => [m.inCents, m.outCents]));
  const step = niceStep(max / 3), top = Math.ceil(max / step) * step;
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const gw = (W - L) / Math.max(1, months.length), bw = 16;
  const bar = (cx: number, v: number, fill: string, op = 1) => {
    const r = Math.min(4, (H - B - y(v)) / 2);
    return <path d={`M${cx} ${H - B}V${y(v) + r}q0 -${r} ${r} -${r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${H - B}Z`} fill={fill} opacity={op} />;
  };
  const ticks: number[] = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  return (
    <div className="chart" ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Entradas e saídas por mês" onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke={v ? "var(--grid)" : "var(--axis)"} />
            <text x={L - 8} y={y(v) + 5} fontSize="15" fill="var(--muted)" textAnchor="end" className="num money">{v ? `${(v / 100000).toLocaleString("pt-BR")} mil` : "0"}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = L + gw * i + gw / 2 - bw - 1;
          return (
            <g key={m.label} onMouseEnter={() => setHover(i)}>
              <rect x={L + gw * i} y={T} width={gw} height={H - T - B} fill="transparent" />
              {bar(cx, m.inCents, "var(--in-mark)")}
              {bar(cx + bw + 2, m.outCents, "var(--out-mark)", m.partial ? 0.55 : 1)}
              <text x={cx + bw + 1} y={H - 6} fontSize="15" fill={m.partial ? "var(--ink-2)" : "var(--muted)"} textAnchor="middle">{m.label}{m.partial ? "*" : ""}</text>
            </g>
          );
        })}
      </svg>
      <DataTable caption="Entradas e saídas por mês" head={["Mês", "Entradas", "Saídas"]}
        rows={months.map((m) => [`${m.label}${m.partial ? " (parcial)" : ""}`, brl(m.inCents), brl(m.outCents)])} />
      {hover !== null && (
        <div className="tooltip" style={{ left: `${Math.min(62, ((L + gw * hover) / W) * 100)}%`, top: 0 }}>
          <div className="muted">{months[hover].label}{months[hover].partial ? " (parcial)" : ""}</div>
          <div className="num money in">+ {brl(months[hover].inCents)}</div>
          <div className="num money out">− {brl(months[hover].outCents)}</div>
        </div>
      )}
    </div>
  );
}

/** Saldo que conta do zero ao abrir (uma vez); valor final já no HTML e parado com movimento reduzido. */
export function CountUp({ cents }: { cents: number }) {
  const [v, setV] = useState(cents);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || sessionStorage.getItem("fluxo-counted")) return;
    sessionStorage.setItem("fluxo-counted", "1");
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 1000);
      setV(Math.round(cents * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cents]);
  return <span className="num money">{brl(v)}</span>;
}

/** Parcelas futuras por mês (uma série, sem legenda; o título nomeia a série). */
export function FutureBars({ months }: { months: { label: string; cents: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useChartWidth(640);
  const H = 220, L = 70, B = 28, T = 22;
  const max = Math.max(1, ...months.map((m) => m.cents));
  const step = niceStep(max / 2), top = Math.ceil(max / step) * step;
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const gw = (W - L) / Math.max(1, months.length), bw = 34;
  const ticks: number[] = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const peak = months.reduce((b, m, i) => (m.cents > months[b].cents ? i : b), 0);
  return (
    <div className="chart" ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Parcelas futuras por mês" onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke={v ? "var(--grid)" : "var(--axis)"} />
            <text x={L - 8} y={y(v) + 4} fontSize="13" fill="var(--muted)" textAnchor="end" className="num money">{!v ? "0" : top >= 200000 ? `${(v / 100000).toLocaleString("pt-BR")} mil` : `R$ ${(v / 100).toLocaleString("pt-BR")}`}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = L + gw * i + gw / 2 - bw / 2, r = Math.min(4, (H - B - y(m.cents)) / 2);
          return (
            <g key={m.label} onMouseEnter={() => setHover(i)}>
              <rect x={L + gw * i} y={T} width={gw} height={H - T - B} fill="transparent" />
              {m.cents > 0 && <path d={`M${cx} ${H - B}V${y(m.cents) + r}q0 -${r} ${r} -${r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${H - B}Z`} fill="var(--c1)" />}
              <text x={cx + bw / 2} y={H - 8} fontSize="13" fill="var(--muted)" textAnchor="middle">{m.label}</text>
              {i === peak && m.cents > 0 && <text x={cx + bw / 2} y={y(m.cents) - 6} fontSize="13" fill="var(--ink-2)" textAnchor="middle" className="num money">{brl(m.cents)}</text>}
            </g>
          );
        })}
      </svg>
      <DataTable caption="Parcelas futuras por mês" head={["Mês", "Parcelas"]} rows={months.map((m) => [m.label, brl(m.cents)])} />
      {hover !== null && <div className="tooltip" style={{ left: `${Math.min(70, ((L + gw * hover) / W) * 100)}%`, top: 0 }}><div className="muted">{months[hover].label}</div><div className="num money">{brl(months[hover].cents)}</div></div>}
    </div>
  );
}

/** Os mesmos dados do gráfico em tabela: para leitores de tela e para conferir números (skill dataviz). */
export function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="data-view">
      <summary>Ver dados em tabela</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{head.map((h, i) => <th key={h} scope="col" className={i ? "r" : ""}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j} className="r num money">{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

/** Patrimônio líquido mês a mês (uma série). Meses estimados: trecho tracejado e ponto vazado. */
export function NetWorthLine({ points }: { points: { label: string; cents: number; estimated: boolean }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useChartWidth(760);
  const H = 280, L = 84, B = 28, T = 16, R = 16;
  if (!points.length) return null;
  const vals = points.map((p) => p.cents);
  // eixo ajustado aos dados (a variação aparece); o zero entra só se a série cruzar o zero
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.25, Math.abs(hi) * 0.02, 50000);
  lo -= pad; hi += pad;
  if (Math.min(...vals) >= 0 && lo < 0) lo = 0;
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const n = points.length;
  const x = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks: number[] = []; for (let v = lo; v <= hi + 1; v += step) ticks.push(v);
  const useMil = hi - lo >= 200000;
  const short = (v: number) => (v === 0 ? "R$ 0" : useMil ? `${v < 0 ? "−" : ""}R$ ${(Math.abs(v) / 100000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : brl(v));
  const lastEst = points.reduce((k, p, i) => (p.estimated ? i : k), -1);
  const seg = (a: number, b: number) => points.slice(a, b + 1).map((p, k) => `${k ? "L" : "M"}${x(a + k).toFixed(1)} ${y(p.cents).toFixed(1)}`).join("");
  return (
    <div className="chart" ref={box} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Evolução do patrimônio líquido"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          setHover(n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
        }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--axis)" : "var(--grid)"} />
            <text x={L - 8} y={y(v) + 4} fill="var(--muted)" fontSize="13" textAnchor="end" className="num money">{short(v)}</text>
          </g>
        ))}
        {points.map((p, i) => (n <= 6 || i % 2 === (n - 1) % 2) && <text key={p.label} x={x(i)} y={H - 6} fill="var(--muted)" fontSize="13" textAnchor={n > 1 && i === n - 1 ? "end" : n > 1 && i === 0 ? "start" : "middle"}>{p.label}</text>)}
        {lastEst >= 0 && <path d={seg(0, Math.min(n - 1, lastEst + 1))} fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="5 5" />}
        {lastEst < n - 1 && <path d={seg(Math.max(0, lastEst + 1), n - 1)} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />}
        {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.cents)} r={i === n - 1 || hover === i ? 5 : 3.5} fill={p.estimated ? "var(--surface-1)" : "var(--ink)"} stroke={p.estimated ? "var(--ink-2)" : "var(--surface-1)"} strokeWidth="2" />)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--border-strong)" />}
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" />
      </svg>
      <DataTable caption="Patrimônio líquido por mês" head={["Mês", "Patrimônio líquido", "Origem"]}
        rows={points.map((p) => [p.label, brl(p.cents), p.estimated ? "estimado" : "registrado"])} />
      {hover !== null && (
        <div className="tooltip" style={{ left: `${Math.min(76, (x(hover) / W) * 100 + 1.5)}%`, top: 8 }}>
          <div className="muted">{points[hover].label}{points[hover].estimated ? " · estimado" : ""}</div>
          <div className="num money" style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>{brl(points[hover].cents)}</div>
        </div>
      )}
    </div>
  );
}
