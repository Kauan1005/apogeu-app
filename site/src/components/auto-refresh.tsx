"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Busca os dados de novo a cada `seconds` (padrão 5s) sem recarregar a página:
 * o Next atualiza só o que mudou, então a tela não pisca e o que você digitou/filtrou continua lá.
 * Pausa com a aba escondida, com uma janela (dialog) aberta ou enquanto um campo está em edição.
 */
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    const id = setInterval(() => {
      if (pending || document.visibilityState !== "visible") return;
      if (document.querySelector("dialog[open]")) return;
      const el = document.activeElement;
      if (el && el.matches("input:not([type=checkbox]), textarea, select")) return;
      start(() => router.refresh());
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds, pending]);
  return null;
}
