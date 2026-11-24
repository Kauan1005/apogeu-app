"use client";
import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui";
import { notify } from "@/components/notify";
import { clearSnapshot, OFFLINE_FLAG } from "@/lib/offline";

const subscribe = (cb: () => void) => { window.addEventListener("storage", cb); window.addEventListener("apogeu-offline", cb); return () => { window.removeEventListener("storage", cb); window.removeEventListener("apogeu-offline", cb); }; };
const read = () => { try { return localStorage.getItem(OFFLINE_FLAG) !== "0"; } catch { return true; } };

/** Liga e desliga o resumo guardado neste aparelho para abrir o app sem internet. Desligar apaga o que estava guardado. */
export function OfflineToggle() {
  const on = useSyncExternalStore(subscribe, read, () => true);
  const set = (v: boolean) => {
    try { localStorage.setItem(OFFLINE_FLAG, v ? "1" : "0"); } catch { /* sem armazenamento */ }
    if (!v) { clearSnapshot(); try { localStorage.removeItem("apogeu-offline-warm"); } catch { /* ok */ } }
    window.dispatchEvent(new Event("apogeu-offline"));
    notify(v ? "Vai abrir sem internet a partir da próxima vez que você entrar no Painel." : "Resumo sem internet desligado e apagado deste aparelho.");
  };
  return (
    <div className="sec-row">
      <div className="sec-head">
        <b>Abrir sem internet</b>
        <span className={`st ${on ? "paid" : "pend"}`}><Icon name={on ? "check" : "alert"} size="sm" />{on ? "Ligado" : "Desligado"}</span>
      </div>
      <p className="t-sm muted">Guarda neste aparelho só os totais do Painel (sem extrato). Apaga ao sair ou depois de 2 horas parado.</p>
      <div className="sec-actions">
        <button className="btn" onClick={() => set(!on)}>{on ? "Desligar" : "Ligar"}</button>
      </div>
    </div>
  );
}
