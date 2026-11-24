import type { CSSProperties } from "react";
import { ICONS } from "./icon-paths";
import { brl } from "@/lib/format";

export function Icon({ name, size = "", label }: { name: string; size?: "" | "sm" | "lg"; label?: string }) {
  return (
    <svg
      className={`i ${size}`}
      viewBox={name === "pix" ? "0.631 0.631 22.738 22.74" : "0 0 24 24"}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? "" }}
    />
  );
}

const MARKS: Record<string, string> = {
  nubank: "nubank", "mercado pago": "mercadopago", mercadopago: "mercadopago", bradesco: "bradesco", itau: "itau", "itaú": "itau", santander: "santander",
  picpay: "picpay", neon: "neon", pagseguro: "pagseguro", pagbank: "pagseguro", cora: "cora", bmg: "bmg", modal: "modal",
  "banco inter": "inter", inter: "inter", "banco do brasil": "bb", c6: "c6", caixa: "caixa",
};
/** Logos enviados em imagem (a própria imagem preenche o azulejo); os demais são SVG de uma cor sobre o azulejo claro. */
const RASTER = new Set(["inter", "bb", "c6", "caixa"]);
const markSrc = (mark: string) => `/icons/${mark}.${RASTER.has(mark) ? "png" : "svg"}`;

/** Logo real quando existe em fonte permitida; senão ícone neutro de banco (nunca uma imitação). */
export function BankTile({ institution }: { institution: string | null }) {
  const key = (institution ?? "").toLowerCase();
  const mark = Object.entries(MARKS).find(([k]) => key.includes(k))?.[1];
  return mark ? (
    <span className={`bank-tile${RASTER.has(mark) ? " full" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={markSrc(mark)} alt="" width={18} height={18} />
    </span>
  ) : (
    <span className="bank-tile neutral">
      <Icon name="landmark" size="sm" />
    </span>
  );
}

/** Logo (quando existe) ou ícone de banco com brilho suave na cor da marca. Sem cor conhecida, cai no BankTile comum. */
export function BankBadge({ name, color, size = "" }: { name: string | null; color: string | null; size?: "" | "lg" }) {
  if (!color) return <BankTile institution={name} />;
  const key = (name ?? "").toLowerCase();
  const mark = Object.entries(MARKS).find(([k]) => key.includes(k))?.[1];
  const style = { "--bank": color } as CSSProperties;
  return mark ? (
    <span className={`bank-tile glow ${size}${RASTER.has(mark) ? " full" : ""}`} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={markSrc(mark)} alt="" width={size ? 26 : 18} height={size ? 26 : 18} />
    </span>
  ) : (
    <span className={`bank-tile neutral glow ${size}`} style={style}><Icon name="landmark" size={size ? "" : "sm"} /></span>
  );
}

/** Valor em reais; recebe a classe `money` para o modo privacidade. */
export function Money({ cents, sign = false, color = false, className = "" }: { cents: number; sign?: boolean; color?: boolean; className?: string }) {
  const tone = color ? (cents > 0 ? "in" : cents < 0 ? "out" : "muted") : "";
  return <span className={`num money ${tone} ${className}`}>{brl(cents, sign)}</span>;
}

export const CAT_COLOR = (color: string | null) => (color ? `var(--${color})` : "var(--c-rest)");

export function CatDot({ color }: { color: string | null }) {
  return <span className="dot" style={{ background: CAT_COLOR(color) }} />;
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string, string]> = {
    pago: ["check", "Pago", "paid"],
    atrasado: ["alert", "Atrasada", "late"],
    pendente: ["clock", "Pendente", "pend"],
  };
  const [icon, label, cls] = map[status] ?? map.pendente;
  return <span className={`st ${cls}`}><Icon name={icon} size="sm" />{label}</span>;
}
