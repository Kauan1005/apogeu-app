"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Brand } from "@/components/brand";
import { PasswordInput } from "@/components/password-input";

export function SetPassword({ email, termsVersion }: { email: string; termsVersion: string }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="auth-wrap">
      <form className="card auth-card" onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const pw = String(f.get("password")), again = String(f.get("again"));
        if (pw.length < 12) return setErr("Use pelo menos 12 caracteres.");
        if (pw !== again) return setErr("As senhas não conferem.");
        setBusy(true); setErr("");
        const { error } = await createClient().auth.updateUser({ password: pw, data: { terms_version: termsVersion, terms_accepted_at: new Date().toISOString() } });
        setBusy(false);
        if (error) return setErr(error.message.includes("weak") ? "Senha fraca demais. Misture letras, números e símbolos." : "Não foi possível salvar a senha. Abra o link de novo.");
        router.replace("/mfa");
      }}>
        <div className="brand" style={{ padding: 0 }}><Brand /></div>
        <h1 style={{ fontSize: 24, fontWeight: 500 }}>Crie a sua senha</h1>
        <p className="ink2 t-sm">Você foi convidado para acompanhar as finanças da casa. Entrando como <b style={{ fontWeight: 500 }}>{email}</b>. Depois da senha, cadastre o app autenticador (2FA).</p>
        <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
        <label className="f">Nova senha<PasswordInput name="password" autoComplete="new-password" minLength={12} /></label>
        <label className="f">Repita a senha<PasswordInput name="again" autoComplete="new-password" minLength={12} /></label>
        {err && <span className="err" role="alert">{err}</span>}
        <button className="btn primary" disabled={busy} style={{ height: 44, justifyContent: "center" }}>{busy ? "Salvando…" : "Salvar e continuar"}</button>
        <p className="t-xs muted">Ao continuar você concorda com os <Link className="link" href="/termos">Termos de uso</Link> e a <Link className="link" href="/privacidade">Política de privacidade</Link>.</p>
      </form>
    </main>
  );
}
