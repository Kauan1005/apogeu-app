"use client";
import { useTransition } from "react";
import { setRecurringFlag } from "../actions";

export function FlagButtons({ k, status }: { k: string; status: "confirmed" | "ignored" | null }) {
  const [pending, start] = useTransition();
  if (status === "ignored") {
    return <button className="btn ghost" disabled={pending} onClick={() => start(() => setRecurringFlag(k, null))}>Voltar a monitorar</button>;
  }
  return (
    <div className="row-flex" style={{ gap: 6 }}>
      {status !== "confirmed" && <button className="btn" disabled={pending} onClick={() => start(() => setRecurringFlag(k, "confirmed"))}>Confirmar</button>}
      <button className="btn ghost" disabled={pending} onClick={() => start(() => setRecurringFlag(k, "ignored"))}>Ignorar</button>
    </div>
  );
}
