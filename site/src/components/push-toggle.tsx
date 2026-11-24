"use client";
import { useEffect, useState } from "react";
import { Icon } from "./ui";
import { notify } from "./notify";
import { removePushSubscription, savePushSubscription } from "@/app/(app)/actions";

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const toBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Sino: liga ou desliga, neste aparelho, o aviso de conta que vence amanhã. */
export function PushToggle() {
  const [state, setState] = useState<"off" | "on" | "busy" | "blocked" | "none">("none");

  useEffect(() => {
    if (!KEY || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      if (!reg) return; // sem service worker (ex.: rodando no computador em modo local)
      const sub = await reg.pushManager.getSubscription();
      setState(Notification.permission === "denied" ? "blocked" : sub ? "on" : "off");
    }).catch(() => {});
  }, []);

  if (state === "none") return null;

  const toggle = async () => {
    const reg = await navigator.serviceWorker.ready;
    if (state === "on") {
      setState("busy");
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
      setState("off"); notify("Avisos desligados neste aparelho.");
      return;
    }
    setState("busy");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); notify("Permissão negada. Libere as notificações do site no navegador."); return; }
    try {
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(KEY) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await savePushSubscription({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
      if (r?.error) throw new Error(r.error);
      setState("on"); notify("Pronto: você recebe um aviso na véspera de cada vencimento.");
    } catch {
      setState("off"); notify("Não foi possível ativar. No iPhone, instale o app na tela inicial antes.");
    }
  };

  const on = state === "on";
  return (
      <button className="btn icon" onClick={toggle} disabled={state === "busy" || state === "blocked"} aria-pressed={on}
        aria-label={state === "blocked" ? "Notificações bloqueadas no navegador" : on ? "Desligar aviso de vencimento" : "Avisar no celular na véspera do vencimento"}
        title={state === "blocked" ? "Notificações bloqueadas no navegador" : on ? "Aviso de vencimento ligado" : "Avisar na véspera do vencimento"}
        style={on ? { background: "var(--ink)", color: "var(--bg)" } : undefined}>
        <Icon name="bell" />
      </button>
  );
}
