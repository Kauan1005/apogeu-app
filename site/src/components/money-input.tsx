"use client";
import { useState, type CSSProperties } from "react";
import { formatMoneyInput, parseMoney } from "@/lib/money";

/**
 * Campo de valor em reais: aceita "1.234,56" (ou "1234.56") e formata ao sair do campo.
 * O formulário recebe o número normalizado ("1234.56") num campo escondido com o `name`.
 */
export function MoneyInput({ name, defaultValue, required, placeholder = "0,00", style, ...aria }: {
  name: string; defaultValue?: number | null; required?: boolean; placeholder?: string; style?: CSSProperties; "aria-label"?: string;
}) {
  const [text, setText] = useState(defaultValue != null && Number.isFinite(defaultValue) ? formatMoneyInput(defaultValue) : "");
  const n = parseMoney(text);
  const invalid = text.trim() !== "" && Number.isNaN(n);
  return (
    <>
      <input className="input money-in" type="text" inputMode="decimal" autoComplete="off" required={required} placeholder={placeholder}
        value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if (!Number.isNaN(n)) setText(formatMoneyInput(n)); }}
        aria-invalid={invalid} style={style} {...aria} />
      <input type="hidden" name={name} value={Number.isNaN(n) ? "" : String(n)} />
    </>
  );
}
