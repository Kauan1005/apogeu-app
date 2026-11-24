import { ViewTransition } from "react";

/** Transição suave entre telas: a anterior some rápido, a nova entra com um leve deslizar (só opacidade e transform). */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="vt-enter" exit="vt-exit" default="none">
      {children}
    </ViewTransition>
  );
}
