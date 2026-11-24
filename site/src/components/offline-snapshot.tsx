"use client";
import { useEffect } from "react";
import { saveSnapshot, warmOffline, type Snapshot } from "@/lib/offline";

/** Guarda neste aparelho o resumo do Painel (só totais) para o app abrir sem internet. Não desenha nada. */
export function OfflineSnapshot({ data }: { data: Snapshot }) {
  const json = JSON.stringify(data);
  useEffect(() => {
    saveSnapshot(JSON.parse(json) as Snapshot);
    void warmOffline();
  }, [json]);
  return null;
}
