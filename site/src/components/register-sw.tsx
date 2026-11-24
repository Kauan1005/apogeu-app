"use client";
import { useEffect } from "react";

/** Registra o service worker do PWA (sem script inline, compatível com a CSP com nonce). */
export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator && location.hostname !== "localhost") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
