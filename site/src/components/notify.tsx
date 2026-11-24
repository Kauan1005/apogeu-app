"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";

type Note = { id: number; text: string; undo?: () => Promise<unknown> };
let seq = 0;

/** Mostra um aviso discreto no rodapé por 5 s; com `undo`, oferece "Desfazer". */
export function notify(text: string, undo?: () => Promise<unknown>) {
  window.dispatchEvent(new CustomEvent<Note>("apogeu-note", { detail: { id: ++seq, text, undo } }));
}

export function NoteHost() {
  const router = useRouter();
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const on = (e: Event) => {
      const n = (e as CustomEvent<Note>).detail;
      setNote(n); setBusy(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setNote((cur) => (cur?.id === n.id ? null : cur)), n.undo ? 6000 : 4000);
    };
    window.addEventListener("apogeu-note", on);
    return () => { window.removeEventListener("apogeu-note", on); clearTimeout(timer.current); };
  }, []);

  return (
    <div className="note-host" aria-live="polite">
      {note && (
        <div className="note" key={note.id}>
          <span>{note.text}</span>
          {note.undo && (
            <button className="note-undo" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await note.undo!(); setNote({ id: ++seq, text: "Desfeito." }); router.refresh(); }
              catch { setNote({ id: ++seq, text: "Não foi possível desfazer." }); }
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setNote(null), 2500);
            }}><Icon name="undo" size="sm" />Desfazer</button>
          )}
          <button className="note-x" aria-label="Fechar aviso" onClick={() => setNote(null)}><Icon name="x" size="sm" /></button>
        </div>
      )}
    </div>
  );
}
