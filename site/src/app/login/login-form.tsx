"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { withPasskeyHint } from "@/lib/passkey-hint";
import { forgetActivity } from "@/components/shell";
import { Brand } from "@/components/brand";
import { PasswordInput } from "@/components/password-input";

/** Este aparelho tem biometria cadastrada (marcada ao cadastrar) e o navegador sabe usar? */
const hasPasskeyHere = () => { try { return !!window.PublicKeyCredential && localStorage.getItem("apogeu-passkey") === "1"; } catch { return false; } };

function LoginForm() {
  const router = useRouter();
  const passkey = useSyncExternalStore(() => () => {}, hasPasskeyHere, () => false);
  const params = useSearchParams();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  /** Biometria: abre o seletor do aparelho. Sem o código, só se a pessoa ligou isso em Ajustes (marca do servidor). */
  const entrarComBiometria = async (auto: boolean) => {
    setBusy(true); setErr("");
    const { data, error } = await withPasskeyHint(() => createClient().auth.signInWithPasskey());
    setBusy(false);
    if (error || !data?.session) { if (!auto) setErr("Não foi possível entrar com a biometria. Use e-mail e senha."); return; }
    forgetActivity();
    const m = data.user?.app_metadata;
    router.replace(m?.mfa_optional === true || m?.passkey_skips_mfa === true ? "/" : "/mfa");
    router.refresh();
  };
  // ao abrir o app neste aparelho, já pede a biometria (uma vez); depois de "Sair" ou de um erro, espera o toque
  const tentou = useRef(false);
  const quieto = !!(params.get("saiu") || params.get("erro") || params.get("excluida"));
  useEffect(() => {
    if (tentou.current || !passkey || quieto) return;
    tentou.current = true;
    void entrarComBiometria(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passkey, quieto]);
  return (
    <form className="card auth-card" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setErr("");
      const f = new FormData(e.currentTarget);
      const { data, error } = await createClient().auth.signInWithPassword({ email: String(f.get("email")), password: String(f.get("password")) });
      setBusy(false);
      if (error) return setErr("E-mail ou senha incorretos.");
      forgetActivity();
      // conta com a exigência de 2FA desligada (escolha da própria pessoa) entra direto
      router.replace(data.user?.app_metadata?.mfa_optional === true ? "/" : "/mfa");
      router.refresh();
    }}>
      <div className="brand" style={{ padding: 0 }}><Brand /></div>
      <h1 style={{ fontSize: 24, fontWeight: 500 }}>Entrar</h1>
      {params.get("bloqueado") && <p className="ink2 t-sm" role="status">Sessão bloqueada depois de 2 horas sem uso.</p>}
      {params.get("excluida") && <p className="ink2 t-sm" role="status">Sua conta e todos os dados foram excluídos.</p>}
      {params.get("erro") === "sem-acesso" && <p className="err" role="alert">Este e-mail não tem acesso ao Apogeu.</p>}
      {params.get("erro") === "link" && <p className="err" role="alert">Link de convite inválido ou vencido. Peça um novo a quem convidou.</p>}
      <label className="f">E-mail<input className="input" name="email" type="email" autoComplete="username" required /></label>
      <label className="f">Senha<PasswordInput name="password" autoComplete="current-password" minLength={8} /></label>
      {err && <span className="err" role="alert">{err}</span>}
      <button className="btn primary" disabled={busy} style={{ height: 44, justifyContent: "center" }}>{busy ? "Entrando…" : "Entrar"}</button>
      {passkey && (
        <button type="button" className="btn" disabled={busy} style={{ height: 44, justifyContent: "center" }} onClick={() => void entrarComBiometria(false)}>Entrar com biometria</button>
      )}
      <p className="t-xs muted">Tem um código de convite? <Link className="link" href="/criar-conta">Criar conta</Link></p>
      <p className="t-xs muted"><Link className="link" href="/privacidade">Privacidade</Link> · <Link className="link" href="/termos">Termos</Link></p>
    </form>
  );
}

export function LoginScreen() {
  return <main className="auth-wrap"><Suspense><LoginForm /></Suspense></main>;
}
