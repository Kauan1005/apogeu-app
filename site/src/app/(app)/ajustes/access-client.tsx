"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { cancelSignupCode, createSignupCode, removePluggyCredentials, savePluggyCredentials } from "./access-actions";
import { Icon } from "@/components/ui";
import { useReauth } from "@/components/reauth";

type State = null | { ok?: boolean; error?: string; reauth?: boolean; message?: string };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const validId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
const validSecret = (v: string) => /^\S{20,200}$/.test(v.trim());

/**
 * Chaves da Pluggy. "Colar" lê o que foi copiado (se vierem as duas chaves juntas, separa sozinho)
 * e, com as duas preenchidas por colagem, já confere na Pluggy, sem precisar clicar.
 */
export function PluggyCredentialsForm({ configured, next = "/ajustes#acesso" }: { configured: boolean; next?: string }) {
  const [state, action, pending] = useActionState(savePluggyCredentials, null as State);
  const reauth = useReauth(next);
  const [removing, start] = useTransition();
  const [err, setErr] = useState("");
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [autoSend, setAutoSend] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { reauth(state); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state?.ok) { setId(""); setSecret(""); } }, [state]); // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!autoSend || pending || !validId(id) || !validSecret(secret)) return;
    setAutoSend(false); // eslint-disable-line react-hooks/set-state-in-effect
    form.current?.requestSubmit();
  }, [autoSend, id, secret, pending]);

  const take = (text: string, field: "id" | "secret") => {
    const t = text.trim();
    const uuids = t.match(UUID) ?? [];
    if (uuids.length >= 2) { setId(uuids[0]!); setSecret(uuids[1]!); }      // copiou as duas de uma vez
    else if (field === "id") setId(uuids[0] ?? t);
    else setSecret(t);
    setErr(""); setAutoSend(true);
  };
  const paste = async (field: "id" | "secret") => {
    try { take(await navigator.clipboard.readText(), field); }
    catch { setErr("O navegador não deixou ler a área de transferência. Cole com Ctrl+V (ou toque e segure no celular)."); }
  };

  return (
    <form ref={form} action={action} className="grid" style={{ gap: 12, marginTop: 14 }}>
      <label className="f">client_id
        <span className="paste-field">
          <input className="input mono" name="client_id" required autoComplete="off" spellCheck={false} placeholder="00000000-0000-0000-0000-000000000000"
            value={id} onChange={(e) => setId(e.target.value)} onPaste={(e) => { e.preventDefault(); take(e.clipboardData.getData("text"), "id"); }} aria-invalid={!!id && !validId(id)} />
          <button type="button" className="btn ghost" onClick={() => paste("id")}><Icon name="clip" size="sm" />Colar</button>
        </span>
      </label>
      <label className="f">client_secret
        <span className="paste-field">
          <input className="input mono" name="client_secret" type="password" required autoComplete="off" spellCheck={false}
            value={secret} onChange={(e) => setSecret(e.target.value)} onPaste={(e) => { e.preventDefault(); take(e.clipboardData.getData("text"), "secret"); }} />
          <button type="button" className="btn ghost" onClick={() => paste("secret")}><Icon name="clip" size="sm" />Colar</button>
        </span>
      </label>
      <div className="row-flex">
        <button className="btn primary" disabled={pending}><Icon name="lock" size="sm" />{pending ? "Conferindo na Pluggy…" : configured ? "Trocar credenciais" : "Salvar e conferir"}</button>
        {(validId(id) && validSecret(secret) && !pending) && <span className="t-xs muted">pronto para conferir</span>}
        {configured && (
          <button type="button" className="btn ghost" disabled={removing} onClick={() => confirm("Remover a conta Meu Pluggy? Os bancos param de sincronizar até você cadastrar de novo; o histórico continua.") && start(async () => {
            const r = await removePluggyCredentials();
            if (reauth(r)) return;
            if (r.error) setErr(r.error);
          })}>Remover</button>
        )}
      </div>
      {(state?.error || err) && <span className="err" role="alert">{err || state?.error}</span>}
      {state?.ok && <span className="ok-msg" role="status">{state.message}</span>}
    </form>
  );
}

export function SignupCodeButton() {
  const [busy, start] = useTransition();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const reauth = useReauth("/ajustes#acesso");
  return (
    <div className="grid" style={{ gap: 10, marginTop: 14 }}>
      <button className="btn primary" style={{ justifySelf: "start" }} disabled={busy} onClick={() => start(async () => {
        setErr(""); setCopied(false);
        const r = await createSignupCode();
        if (reauth(r)) return;
        if (r.error) return setErr(r.error);
        setCode(r.code ?? "");
      })}><Icon name="plus" size="sm" />{busy ? "Gerando…" : "Gerar código de convite"}</button>
      {err && <span className="err" role="alert">{err}</span>}
      {code && (
        <div className="grid" style={{ gap: 6 }}>
          <span className="t-xs muted">Anote agora: o código aparece só esta vez. Vale 7 dias e uma conta. A pessoa abre /criar-conta no site.</span>
          <div className="row-flex" style={{ gap: 8 }}>
            <input className="input mono" readOnly value={code} aria-label="Código de convite gerado" style={{ flex: 1, minWidth: 0, letterSpacing: ".08em" }} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn" onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); }}><Icon name={copied ? "check" : "clip"} size="sm" />{copied ? "Copiado" : "Copiar"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CancelCode({ id, hint }: { id: string; hint: string }) {
  const [busy, start] = useTransition();
  return (
    <button className="btn ghost icon" aria-label={`Cancelar código final ${hint}`} disabled={busy} style={{ width: 32, height: 32 }}
      onClick={() => start(async () => { await cancelSignupCode(id); })}><Icon name="x" size="sm" /></button>
  );
}
