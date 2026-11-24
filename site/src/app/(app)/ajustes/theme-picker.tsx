"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setTheme, type Theme } from "./theme";

const OPTIONS: { v: Theme; label: string }[] = [{ v: "dark", label: "Escuro" }, { v: "light", label: "Claro" }, { v: "auto", label: "Automático" }];

/** Escolha de aparência. "Automático" segue o tema do aparelho. */
export function ThemePicker({ current }: { current: Theme }) {
  const router = useRouter();
  const [sel, setSel] = useState<Theme>(current);
  const [pending, start] = useTransition();
  return (
    <div className="seg" role="radiogroup" aria-label="Aparência" style={{ alignSelf: "start" }}>
      {OPTIONS.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={sel === o.v} disabled={pending} className={sel === o.v ? "on" : ""}
          onClick={() => { setSel(o.v); start(async () => { await setTheme(o.v); router.refresh(); }); }}>{o.label}</button>
      ))}
    </div>
  );
}
