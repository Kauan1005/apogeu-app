"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui";

/** O mínimo que usamos da API de reconhecimento de fala do navegador (Chrome, Edge e Safari têm; Firefox não). */
type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
};
const ctor = () => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const supported = () => typeof window !== "undefined" && !!ctor();
const never = () => () => {};

const MSG: Record<string, string> = {
  "not-allowed": "Permita o microfone para perguntar por voz.",
  "service-not-allowed": "Este aparelho não deixa usar o reconhecimento de voz.",
  "no-speech": "Não ouvi nada. Toque no microfone e tente de novo.",
  "audio-capture": "Não encontrei um microfone neste aparelho.",
  network: "Sem conexão com o reconhecimento de voz.",
};

/** Botão de microfone para o campo de pergunta: fala, o texto entra no campo e a pergunta é enviada. Só aparece onde o navegador sabe ouvir. */
export function VoiceButton({ field = "q" }: { field?: string }) {
  const ok = useSyncExternalStore(never, supported, () => false);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState("");
  const rec = useRef<Rec | null>(null);
  if (!ok) return null;

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (on) { rec.current?.stop(); return; }
    const form = e.currentTarget.closest("form");
    const input = form?.elements.namedItem(field) as HTMLInputElement | null;
    const Ctor = ctor();
    if (!form || !input || !Ctor) return;
    setErr("");
    const r = new Ctor();
    r.lang = "pt-BR"; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let final = "";
    r.onresult = (ev) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
      input.value = text.trim();
      if (ev.results[ev.results.length - 1].isFinal) final = text.trim();
    };
    r.onerror = (ev) => setErr(MSG[ev.error] ?? "Não consegui ouvir. Tente de novo.");
    r.onend = () => {
      setOn(false);
      if (final) form.requestSubmit(); // fala terminou: faz a pergunta
    };
    rec.current = r;
    try { r.start(); setOn(true); } catch { setErr("Não consegui abrir o microfone."); }
  };

  return (
    <>
      <button type="button" className={`mic${on ? " on" : ""}`} aria-pressed={on} aria-label={on ? "Parar de ouvir" : "Perguntar por voz"} title="Perguntar por voz" onClick={toggle}>
        <Icon name="mic" size="sm" />
      </button>
      {(on || err) && <span className="voice-status t-xs" role="status" style={{ color: err ? "var(--critical-text)" : "var(--ink-2)" }}>{err || "Ouvindo… fale a pergunta"}</span>}
    </>
  );
}

/** Aviso de privacidade: o reconhecimento de voz é do navegador (no Chrome, o áudio é processado pelo Google). Só aparece onde há microfone. */
export function VoiceNote() {
  const ok = useSyncExternalStore(never, supported, () => false);
  if (!ok) return null;
  return <p className="t-xs muted" style={{ margin: 0 }}>O microfone usa o reconhecimento de voz do navegador; no Chrome, o áudio é processado pelo Google. Digitar continua sem enviar nada para fora.</p>;
}
