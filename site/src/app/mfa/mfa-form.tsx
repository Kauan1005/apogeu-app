"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { forgetActivity } from "@/components/shell";
import { Brand } from "@/components/brand";

/** Só caminhos do próprio site: resolve como URL e exige a mesma origem (barra dupla, tab, \\ etc. caem em "/"). */
function safeNext(raw: string) {
  if (typeof window === "undefined" || /[\u0000-\u001f\\]/.test(raw)) return "/";
  try {
    const u = new URL(raw, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search + u.hash : "/";
  } catch { return "/"; }
}

const SEEN = "apogeu-last-code"; // impressão (hash) do último código usado: evita reenviar código velho que sobrou na área de transferência
const sha = async (t: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const remember = async (code: string) => { try { localStorage.setItem(SEEN, await sha(code)); } catch { /* sem armazenamento */ } };
const alreadyUsed = async (code: string) => { try { return localStorage.getItem(SEEN) === (await sha(code)); } catch { return false; } };

// 2FA obrigatório por app autenticador (TOTP). Primeiro acesso: cadastra o app pelo QR. Depois: só o código.
function Mfa() {
  const router = useRouter();
  const params = useSearchParams();
  // só caminhos internos: "/algo", nunca "//site" ou "/\\site" (redirecionamento aberto)
  const rawNext = params.get("next") ?? "/";
  const next = safeNext(rawNext);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const tried = useRef(""); // último código enviado: o mesmo código nunca é reenviado sozinho

  const verify = useCallback(async (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (!factorId || digits.length !== 6 || busy) return;
    tried.current = digits;
    setBusy(true); setErr("");
    await remember(digits);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: digits });
    setBusy(false);
    if (error) { setCode(""); return setErr("Código inválido. Confira o horário do celular e tente de novo."); }
    try { if ((await navigator.clipboard.readText()).replace(/\s/g, "") === digits) await navigator.clipboard.writeText(""); } catch { /* sem permissão: tudo bem */ }
    forgetActivity();
    router.replace(next);
    router.refresh();
  }, [factorId, busy, router, next]);

  // código completo digitado antes de o autenticador terminar de carregar: envia assim que estiver pronto
  useEffect(() => {
    if (factorId && code.length === 6 && tried.current !== code && !busy) void verify(code);
  }, [factorId, code, busy, verify]);

  /** Procura um código de 6 dígitos copiado. `gesture` = veio de um toque (o navegador pode pedir permissão). */
  const fromClipboard = useCallback(async (gesture: boolean) => {
    if (!factorId || busy || !navigator.clipboard?.readText) return;
    try {
      const st = await navigator.permissions?.query({ name: "clipboard-read" as PermissionName }).then((r) => r.state).catch(() => "prompt");
      if (st === "denied" || (st !== "granted" && !gesture)) return; // sem permissão e sem toque: não incomoda
      const text = (await navigator.clipboard.readText()).trim();
      const m = /^(\d{3})\s?(\d{3})$/.exec(text);
      if (!m) return;
      const digits = m[1] + m[2];
      if (digits === tried.current || (await alreadyUsed(digits))) return;
      setCode(digits);
      void verify(digits);
    } catch { /* bloqueado ou sem foco: o código continua podendo ser digitado */ }
  }, [factorId, busy, verify]);

  useEffect(() => {
    if (!factorId) return;
    const first = setTimeout(() => void fromClipboard(false), 0);
    const back = () => { if (document.visibilityState === "visible") void fromClipboard(false); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { clearTimeout(first); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [factorId, fromClipboard]);

  const started = useRef(false);
  useEffect(() => {
    // prepara uma vez só (o modo estrito do React roda efeitos duas vezes e criaria dois autenticadores)
    if (started.current) return;
    started.current = true;
    (async () => {
      const sb = createClient();
      const { data: user } = await sb.auth.getUser();
      if (!user.user) return router.replace("/login");
      const { data } = await sb.auth.mfa.listFactors();
      const verified = data?.totp?.find((f) => f.status === "verified");
      if (verified) return setFactorId(verified.id);
      // limpa cadastros pela metade e cria um novo
      for (const f of data?.all ?? []) if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data: en, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Apogeu", issuer: "Apogeu" });
      if (error || !en) return setErr("Não foi possível iniciar o 2FA.");
      setFactorId(en.id); setQr(en.totp.qr_code); setSecret(en.totp.secret);
    })();
  }, [router]);

  return (
    <form className="card auth-card" onSubmit={(e) => { e.preventDefault(); void verify(code); }}>
      <div className="brand" style={{ padding: 0 }}><Brand /></div>
      <h1 style={{ fontSize: 24, fontWeight: 500 }}>{qr ? "Ative a verificação em duas etapas" : params.get("reauth") ? "Confirme que é você" : "Código de verificação"}</h1>
      {qr && (
        <div className="grid" style={{ gap: 12 }}>
          <p className="ink2 t-sm">Escaneie com o Google Authenticator, Authy ou 1Password e digite o código de 6 dígitos.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code para o app autenticador" width={180} height={180} style={{ background: "#fff", borderRadius: 12, padding: 8 }} />
          <p className="t-xs muted">Sem câmera? Chave: <span className="mono">{secret}</span></p>
        </div>
      )}
      {params.get("reauth") && !qr && <p className="ink2 t-sm">Ações sensíveis pedem o código de novo depois de 15 minutos.</p>}
      <label className="f">Código<input className="input mono" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus
        value={code} onChange={(e) => { const d = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(d); if (d.length === 6) void verify(d); }}
        onFocus={() => void fromClipboard(true)} onPointerDown={() => void fromClipboard(true)} /></label>
      {err && <span className="err" role="alert">{err}</span>}
      <p className="t-xs muted">Copie o código no autenticador: ele é colado e verificado sozinho.</p>
      <button className="btn primary" disabled={busy || !factorId} style={{ height: 44, justifyContent: "center" }}>{busy ? "Verificando…" : "Verificar"}</button>
    </form>
  );
}

export function MfaScreen() {
  return <main className="auth-wrap"><Suspense><Mfa /></Suspense></main>;
}
