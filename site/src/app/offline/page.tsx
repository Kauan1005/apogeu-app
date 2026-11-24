import type { Metadata } from "next";
import { OfflineView } from "./offline-view";

export const metadata: Metadata = { title: "Sem internet" };

// Rota pública e sem dados: o conteúdo vem do que foi guardado no aparelho (src/lib/offline.ts).
export default function Offline() {
  return <OfflineView />;
}
