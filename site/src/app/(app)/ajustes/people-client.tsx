"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { backupLink, backupNow, inviteMember, removeMember, resendInvite, resetMemberMfa } from "./actions";
import { Icon } from "@/components/ui";
import { useReauth } from "@/components/reauth";

type State = null | { ok?: boolean; error?: string; reauth?: boolean; link?: string };

function LinkBox({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid" style={{ gap: 8, marginTop: 12 }}>
      <span className="t-xs muted">Envie este link só para a pessoa convidada (vale 1 hora, uso único). Ela cria a senha e cadastra o 2FA.</span>
      <div className="row-flex" style={{ gap: 8 }}>
        <input className="input" readOnly value={link} aria-label="Link de convite" style={{ flex: 1, minWidth: 0 }} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>
          <Icon name={copied ? "check" : "clip"} size="sm" />{copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMember, null as State);
  const reauth = useReauth("/ajustes#pessoas");
  useEffect(() => { reauth(state); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form action={action} style={{ marginTop: 14 }}>
      <div className="row-flex" style={{ alignItems: "end" }}>
        <label className="f" style={{ flex: "1 1 240px" }}>E-mail da pessoa<input className="input" name="email" type="email" required autoComplete="off" placeholder="nome@exemplo.com" /></label>
        <button className="btn primary" disabled={pending} style={{ height: 40 }}><Icon name="plus" size="sm" />{pending ? "Gerando…" : "Gerar convite"}</button>
      </div>
      {state?.error && <p className="err" role="alert" style={{ marginTop: 8 }}>{state.error}</p>}
      {state?.link && <LinkBox link={state.link} />}
    </form>
  );
}

export function MemberActions({ userId, email, pendingFirstAccess }: { userId: string; email: string; pendingFirstAccess: boolean }) {
  const [busy, start] = useTransition();
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  const reauth = useReauth("/ajustes#pessoas");
  const dlg = useRef<HTMLDialogElement>(null);
  const remove = (keepHistory: boolean) => start(async () => {
    const r = await removeMember(userId, keepHistory);
    dlg.current?.close();
    if (reauth(r)) return;
    if (r.error) setErr(r.error);
  });
  return (
    <div className="grid" style={{ gap: 6, justifyItems: "end" }}>
      <div className="row-flex" style={{ gap: 4 }}>
        {pendingFirstAccess && (
          <button className="btn ghost" disabled={busy} style={{ height: 32 }} onClick={() => start(async () => {
            const r = await resendInvite(userId);
            if (reauth(r)) return;
            if (r.error) return setErr(r.error);
            setLink(r.link ?? "");
          })}>Novo link</button>
        )}
        {!pendingFirstAccess && (
          <button className="btn ghost" disabled={busy} style={{ height: 32 }}
            onClick={() => confirm(`Redefinir o 2FA de ${email}? Use se a pessoa perdeu o celular. No próximo login ela cadastra o autenticador de novo.`) && start(async () => {
              const r = await resetMemberMfa(userId);
              if (reauth(r)) return;
              if (r.error) setErr(r.error);
            })}>Redefinir 2FA</button>
        )}
        <button className="btn ghost icon" aria-label={`Remover acesso de ${email}`} disabled={busy} style={{ width: 32, height: 32 }} onClick={() => dlg.current?.showModal()}>
          <Icon name="x" size="sm" />
        </button>
      </div>
      {err && <span className="err" role="alert">{err}</span>}
      {link && <div style={{ width: "min(420px, 80vw)" }}><LinkBox link={link} /></div>}
      <dialog ref={dlg} className="modal" aria-labelledby={`rm-${userId}`}>
        <h3 id={`rm-${userId}`} style={{ margin: 0 }}>Remover o acesso de {email}?</h3>
        <p className="ink2 t-sm" style={{ marginTop: 10 }}>
          O login dessa pessoa é apagado e os bancos que ela conectou são desconectados na Pluggy. As demais finanças da casa continuam.
          O que fazer com o histórico já importado dos bancos dela?
        </p>
        <div className="grid" style={{ gap: 8, marginTop: 16 }}>
          <button className="btn" disabled={busy} onClick={() => remove(false)}>Remover e apagar o histórico dos bancos dela</button>
          <button className="btn" disabled={busy} onClick={() => remove(true)}>Remover e manter o histórico</button>
          <button className="btn ghost" onClick={() => dlg.current?.close()}>Cancelar</button>
        </div>
      </dialog>
    </div>
  );
}

export function BackupNow() {
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  return (
    <div className="row-flex" style={{ marginTop: 14 }}>
      <button className="btn" disabled={busy} onClick={() => start(async () => {
        const r = await backupNow();
        setMsg(r.error ? { text: r.error } : { ok: true, text: r.message ?? "Backup criado." });
      })}><Icon name="database" size="sm" />{busy ? "Gerando…" : "Fazer backup agora"}</button>
      {msg && <span className={msg.ok ? "ok-msg" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</span>}
    </div>
  );
}

export function BackupDownload({ name }: { name: string }) {
  const [busy, start] = useTransition();
  const [err, setErr] = useState("");
  const reauth = useReauth("/ajustes#backups");
  return (
    <span className="row-flex" style={{ gap: 6 }}>
      {err && <span className="err t-xs" role="alert">{err}</span>}
      <button className="btn ghost icon" aria-label={`Baixar backup ${name}`} disabled={busy} style={{ width: 32, height: 32 }} onClick={() => start(async () => {
        const r = await backupLink(name);
        if (reauth(r)) return;
        if (r.error || !r.link) return setErr(r.error ?? "Falhou.");
        window.location.assign(r.link);
      })}><Icon name="download" size="sm" /></button>
    </span>
  );
}
