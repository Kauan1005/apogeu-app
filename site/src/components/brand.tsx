// Marca Apogeu (modelo H): o "A" aberto em forma de pico, com o ponto no topo (o apogeu),
// separado do nome "apogeu" em Montserrat Medium. Monocromático: usa a cor do texto (currentColor).

/** Só o símbolo. Os traços engrossam um pouco em tamanhos pequenos para continuar legível. */
export function LogoMark({ size = 26, title }: { size?: number; title?: string }) {
  const stroke = size <= 18 ? 9 : size <= 32 ? 8 : 7;
  const dot = size <= 18 ? 7.5 : size <= 32 ? 6.5 : 5.5;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="logo-mark">
      <path d="M10 52 L32 20 L54 52" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="8" r={dot} fill="currentColor" />
    </svg>
  );
}

/** Símbolo + nome, separados. O nome é o último elemento (a barra recolhida esconde só ele). */
export function Brand({ size = 26 }: { size?: number }) {
  return (
    <>
      <LogoMark size={size} />
      <span className="wordmark">apogeu</span>
    </>
  );
}
