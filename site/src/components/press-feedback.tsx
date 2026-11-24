"use client";
import { useEffect } from "react";

/** Elementos que "afundam" ao serem tocados ou clicados. */
const PRESSABLE = ".btn, .nav a, .seg a, .opt, .menu-item, .os-tabs button, .pw-eye, .q, .note-undo, .note-x, .top-more > summary, a.card";
const MIN_MS = 150; // um toque rápido também mostra o botão apertado por tempo suficiente para ser percebido

/**
 * Marca o botão como apertado (atributo data-press) assim que o dedo ou o mouse encosta e só solta
 * depois de um tempo mínimo. O :active sozinho dura poucos milissegundos num toque rápido.
 */
export function PressFeedback() {
  useEffect(() => {
    let current: { el: Element; at: number } | null = null;
    const release = () => {
      if (!current) return;
      const { el, at } = current;
      current = null;
      setTimeout(() => el.removeAttribute("data-press"), Math.max(0, MIN_MS - (performance.now() - at)));
    };
    const down = (e: PointerEvent) => {
      release();
      const el = (e.target as Element | null)?.closest?.(PRESSABLE);
      if (!el || (el as HTMLButtonElement).disabled) return;
      el.setAttribute("data-press", "");
      current = { el, at: performance.now() };
    };
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", release, { passive: true });
    document.addEventListener("pointerleave", release, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
      document.removeEventListener("pointerleave", release);
    };
  }, []);
  return null;
}
