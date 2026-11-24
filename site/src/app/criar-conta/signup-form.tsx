"use client";
import Link from "next/link";
import { useActionState } from "react";
import { signUp } from "./actions";
import { Brand } from "@/components/brand";
import { PasswordInput } from "@/components/password-input";

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUp, null);
  return (
    <main className="auth-wrap">
      <form className="card auth-card" action={action}>
        <div className="brand" style={{ padding: 0 }}><Brand /></div>
        <h1 style={{ fontSize: 24, fontWeight: 500 }}>Criar conta</h1>
        <p className="ink2 t-sm">Você precisa de um código de convite. A conta nova tem finanças só suas.</p>
        <label className="f">Código de convite<input className="input mono" name="code" required autoComplete="off" placeholder="XXXX-XXXX-XXXX" maxLength={20} style={{ textTransform: "uppercase" }} /></label>
        <label className="f">E-mail<input className="input" name="email" type="email" autoComplete="username" required /></label>
        <label className="f">Senha<PasswordInput name="password" autoComplete="new-password" minLength={12} /></label>
        <label className="f">Repita a senha<PasswordInput name="again" autoComplete="new-password" minLength={12} /></label>
        {state?.error && <span className="err" role="alert">{state.error}</span>}
        <button className="btn primary" disabled={pending} style={{ height: 44, justifyContent: "center" }}>{pending ? "Criando…" : "Criar conta"}</button>
        <p className="t-xs muted">Ao criar a conta você concorda com os <Link className="link" href="/termos">Termos de uso</Link> e a <Link className="link" href="/privacidade">Política de privacidade</Link>. Só para maiores de 18 anos.</p>
        <p className="t-xs muted">Depois você cadastra o app autenticador (2FA), obrigatório. Já tem conta? <Link className="link" href="/login">Entrar</Link></p>
      </form>
    </main>
  );
}
