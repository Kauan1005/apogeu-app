/** Mini-gráfico de tendência (sem eixos, sem números): só mostra para onde a linha vai. Server component, SVG puro. */
export function Spark({ values, color = "currentColor", label }: { values: number[]; color?: string; label: string }) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const W = 100, H = 30, P = 3;
  const pts = v.map((x, i) => [P + (i / (v.length - 1)) * (W - 2 * P), H - P - ((x - min) / span) * (H - 2 * P)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(2)} ${H} L${pts[0][0].toFixed(2)} ${H} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ color }}>
      <path d={area} fill="currentColor" opacity=".10" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
