"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";
import { notify } from "@/components/notify";
import { useReauth } from "@/components/reauth";
import { createClient } from "@/lib/supabase/client";
import { forgetPasskeyHint, withPasskeyHint } from "@/lib/passkey-hint";
import { logSecurityEvent, removePasskey, setPasskeySkipsMfa, setTwoFactorRequired } from "./access-actions";

/** Liga e desliga a exigência do código do autenticador. Desligar pede o código recente, confirmação e explica o risco. */
export function TwoFactorSwitch({ on }: { on: boolean }) {
  const router = useRouter();
  const reauth = useReauth("/ajustes#seguranca");
  const dlg = useRef<HTMLDialogElement>(null);
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const apply = (required: boolean) => start(async () => {
    setErr("");
    const r = await setTwoFactorRequired(required, !required && ack);
    if (reauth(r)) return;
    if (r.error) return setErr(r.error);
    dlg.current?.close(); setAck(false);
    await createClient().auth.refreshSession(); // o JWT novo já traz a marca
    notify(required ? "Verificação em duas etapas ligada. Vamos pedir o código." : "Verificação em duas etapas desligada.");
    router.refresh();
  });

  return (
    <div className="sec-row">
      <div className="sec-head">
        <b>Verificação em duas etapas</b>
        <span className={`st ${on ? "paid" : "late"}`}><Icon name={on ? "check" : "alert"} size="sm" />{on ? "Ligada" : "Desligada"}</span>
      </div>
      <p className="t-sm muted">{on ? "Pede o código do app autenticador ao entrar." : "Hoje só e-mail e senha protegem a conta."}</p>
      <div className="sec-actions">
        {on
          ? <button className="btn" onClick={() => { setErr(""); setAck(false); dlg.current?.showModal(); }}>Desligar…</button>
          : <button className="btn primary" disabled={pending} onClick={() => apply(true)}>{pending ? "Ligando…" : "Ligar"}</button>}
      </div>
      {!on && err && <span className="err" role="alert">{err}</span>}
      <dialog ref={dlg} className="modal" aria-label="Desligar a verificação em duas etapas" onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
        <div className="grid" style={{ gap: 14 }}>
          <h3 style={{ fontSize: 18, fontWeight: 500 }}>Desligar a verificação em duas etapas?</h3>
          <p className="ink2 t-sm">Sem o código do autenticador, <b>qualquer pessoa que descubra seu e-mail e sua senha</b> consegue entrar e ver todas as suas finanças, exportar os dados e desconectar bancos. Os bancos continuam protegidos pelo Open Finance, mas o Apogeu fica bem mais fácil de invadir.</p>
          <p className="ink2 t-sm">Você pode ligar de novo quando quiser, sem refazer o cadastro do autenticador.</p>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14 }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 4 }} />
            <span>Entendo o risco e quero desligar.</span>
          </label>
          {err && <span className="err" role="alert">{err}</span>}
          <div className="row-flex" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button className="btn ghost" onClick={() => dlg.current?.close()}>Cancelar</button>
            <button className="btn primary" disabled={!ack || pending} onClick={() => apply(false)}>{pending ? "Desligando…" : "Desligar"}</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

type Pk = { id: string; friendly_name?: string | null; created_at?: string; last_used_at?: string | null };

/** Biometria (passkey) neste aparelho: troca a senha na hora de entrar. O código do autenticador continua valendo se estiver ligado. */
export function PasskeyBox({ skips, twoFactorOn, aal2 }: { skips: boolean; twoFactorOn: boolean; aal2: boolean }) {
  const router = useRouter();
  const reauth = useReauth("/ajustes#seguranca");
  const dlg = useRef<HTMLDialogElement>(null);
  const [ack, setAck] = useState(false);
  const [skipErr, setSkipErr] = useState("");
  const applySkip = (on: boolean) => start(async () => {
    setSkipErr("");
    const r = await setPasskeySkipsMfa(on, on && ack);
    if (reauth(r)) return;
    if (r.error) return setSkipErr(r.error);
    dlg.current?.close(); setAck(false);
    await createClient().auth.refreshSession();
    notify(on ? "Agora a biometria entra direto, sem o código." : "A biometria volta a pedir o código.");
    router.refresh();
  });
  const [state, setState] = useState<"loading" | "off-server" | "unsupported" | "ready">("loading");
  const [list, setList] = useState<Pk[]>([]);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const reload = async () => {
    const { data } = await createClient().auth.passkey.list();
    setList((data ?? []) as Pk[]);
  };

  useEffect(() => {
    (async () => {
      if (!window.PublicKeyCredential) return setState("unsupported");
      try {
        const st = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" } }).then((r) => r.json());
        if (!st.passkeys_enabled) return setState("off-server");
        await reload();
        setState("ready");
      } catch { setState("off-server"); }
    })();
  }, []);

  const add = () => start(async () => {
    setMsg("");
    // o Supabase só deixa cadastrar biometria em sessão que já passou pelo código do autenticador
    if (!aal2) { reauth({ reauth: true }); return; }
    const { error } = await withPasskeyHint(() => createClient().auth.registerPasskey());
    if (error?.code === "insufficient_aal") { reauth({ reauth: true }); return; }
    if (error) return setMsg(error.code === "webauthn_credential_exists" ? "Este aparelho já tem uma biometria cadastrada." : "Não foi possível cadastrar a biometria.");
    try { localStorage.setItem("apogeu-passkey", "1"); } catch { /* sem armazenamento */ }
    await logSecurityEvent("passkey_add");
    await reload();
    notify("Biometria cadastrada neste aparelho.");
  });

  const remove = (id: string) => start(async () => {
    setMsg("");
    const r = await removePasskey(id); // pelo servidor: o navegador não consegue apagar em sessão sem 2FA
    if (r.error) return setMsg(r.error);
    await reload();
    if (list.length <= 1) { try { localStorage.removeItem("apogeu-passkey"); } catch { /* ok */ } forgetPasskeyHint(); }
    notify("Biometria removida.");
  });

  return (
    <div className="sec-row">
      <div className="sec-head">
        <b>Biometria <span className="beta">beta</span></b>
        {state === "ready" && <button className="btn" disabled={pending} onClick={add}><Icon name="plus" size="sm" />{pending ? "Aguarde…" : "Cadastrar"}</button>}
      </div>
      <p className="t-sm muted">Entre com digital ou rosto, sem digitar a senha.{!aal2 && state === "ready" ? " Para cadastrar, o app pede o código do autenticador." : ""}</p>
      {state === "loading" && <span className="t-xs muted">Verificando…</span>}
      {state === "unsupported" && <span className="t-sm ink2">Este navegador não oferece biometria.</span>}
      {state === "off-server" && <span className="t-sm ink2">A biometria ainda não está ligada no servidor de login.</span>}
      {msg && <span className="err" role="alert">{msg}</span>}
      {list.length > 0 && (
        <div className="sec-list">
          {list.map((p) => (
            <div className="sec-item" key={p.id}>
              <Icon name="lock" size="sm" />
              <span className="sec-name">{p.friendly_name || "Biometria"}{p.created_at ? <span className="muted"> · {new Date(p.created_at).toLocaleDateString("pt-BR")}</span> : null}</span>
              <button className="btn ghost sm" disabled={pending} onClick={() => remove(p.id)}>Remover</button>
            </div>
          ))}
        </div>
      )}
      {state === "ready" && list.length > 0 && (
        <div className="sec-sub">
          <div className="sec-head">
            <b>Entrar só com a biometria</b>
            {twoFactorOn && (skips
              ? <button className="btn" disabled={pending} onClick={() => applySkip(false)}>Desligar</button>
              : <button className="btn primary" disabled={pending} onClick={() => { setSkipErr(""); setAck(false); dlg.current?.showModal(); }}>Ligar…</button>)}
          </div>
          <p className="t-sm muted">{!twoFactorOn ? "Já vale: com a verificação em duas etapas desligada, a biometria entra direto." : skips ? "Ligado: entra direto, sem o código." : "Desligado: depois da biometria ainda pede o código."}</p>
        </div>
      )}
      {skipErr && !skips && <span className="err" role="alert">{skipErr}</span>}
      <dialog ref={dlg} className="modal" aria-label="Entrar só com a biometria" onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
        <div className="grid" style={{ gap: 14 }}>
          <h3 style={{ fontSize: 18, fontWeight: 500 }}>Entrar só com a biometria?</h3>
          <p className="ink2 t-sm">O app abre direto com digital ou rosto, sem pedir o código do autenticador. É mais cômodo, mas o código deixa de ser a segunda barreira: <b>quem conseguir desbloquear este aparelho, ou entrar na sua conta Google se a biometria estiver sincronizada, abre o Apogeu sem o código</b>.</p>
          <p className="ink2 t-sm">Conectar banco, exportar dados e excluir a conta continuam pedindo o código. Você pode desligar quando quiser.</p>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14 }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 4 }} />
            <span>Entendo o risco e quero ligar.</span>
          </label>
          {skipErr && <span className="err" role="alert">{skipErr}</span>}
          <div className="row-flex" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button className="btn ghost" onClick={() => dlg.current?.close()}>Cancelar</button>
            <button className="btn primary" disabled={!ack || pending} onClick={() => applySkip(true)}>{pending ? "Ligando…" : "Ligar"}</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
