"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "./ui";
import { Brand } from "./brand";
import { createClient } from "@/lib/supabase/client";

import { MOBILE, NAV, SHORT } from "./nav";

export function Sidebar({ review, lastSync, connections }: { review: number; lastSync: string | null; connections: number }) {
  const path = usePathname();
  return (
    <aside className="side">
      <Link className="brand" href="/">
        <Brand />
      </Link>
      <nav className="nav" aria-label="Principal">
        {NAV.map(([icon, label, href]) => {
          const on = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} className={`${on ? "on" : ""} ${MOBILE.includes(href) ? "" : "desk-only"}`} aria-current={on ? "page" : undefined}>
              <Icon name={icon} />
              {SHORT[href] ? <><span className="desk-label">{label}</span><span className="mob-label">{SHORT[href]}</span></> : label}
              {href === "/revisar" && review > 0 && <span className="badge warn">{review}</span>}
            </Link>
          );
        })}
        <Link href="/mais" className={`mob-only ${path === "/mais" || !MOBILE.some((h) => (h === "/" ? path === "/" : path.startsWith(h))) ? "on" : ""}`}>
          <Icon name="more" />Mais
        </Link>
      </nav>
      <div className="foot">
        <span style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <Icon name="refresh" size="sm" />
          {lastSync ? `Sincronizado ${new Date(lastSync).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Ainda não sincronizado"}
        </span>
        <span style={{ paddingLeft: 30 }}>{connections} {connections === 1 ? "conexão" : "conexões"}</span>
      </div>
    </aside>
  );
}

export function MonthNav({ label, prev, next }: { label: string; prev: string; next: string }) {
  const params = useSearchParams();
  const path = usePathname();
  const href = (m: string) => {
    const q = new URLSearchParams(params.toString());
    q.set("mes", m);
    return `${path}?${q.toString()}`;
  };
  return (
    <div className="seg" role="group" aria-label="Mês">
      <Link href={href(prev)} aria-label="Mês anterior" style={{ display: "grid", placeItems: "center", width: 36, color: "var(--ink-2)" }}>
        <Icon name="chevleft" size="sm" />
      </Link>
      <span className="on">{label}</span>
      <Link href={href(next)} aria-label="Próximo mês" style={{ display: "grid", placeItems: "center", width: 36, color: "var(--ink-2)" }}>
        <Icon name="chevright" size="sm" />
      </Link>
    </div>
  );
}

/** Modo privacidade: borra todos os valores. Preferência guardada só neste navegador. */
export function PrivacyToggle() {
  const on = useSyncExternalStore(
    (cb) => { window.addEventListener("fluxo-privacy", cb); window.addEventListener("storage", cb); return () => { window.removeEventListener("fluxo-privacy", cb); window.removeEventListener("storage", cb); }; },
    () => { try { return localStorage.getItem("fluxo-privacy") === "1"; } catch { return false; } },
    () => false,
  );
  useEffect(() => { document.documentElement.classList.toggle("privacy-on", on); }, [on]);
  const toggle = () => {
    try { localStorage.setItem("fluxo-privacy", on ? "0" : "1"); } catch {}
    window.dispatchEvent(new Event("fluxo-privacy"));
  };
  return (
    <button className="btn icon" aria-pressed={on} aria-label={on ? "Mostrar valores" : "Ocultar valores"} onClick={toggle}
      style={on ? { background: "var(--ink)", color: "var(--bg)" } : undefined}>
      <Icon name={on ? "eyeoff" : "eye"} />
    </button>
  );
}

/** Bloqueia a sessão depois de 2 horas sem uso. */
/**
 * Bloqueio depois de `minutes` sem uso. Guarda o horário real da última atividade (compartilhado entre
 * abas) e confere a cada minuto e ao voltar para a página: assim o bloqueio vale mesmo depois de o
 * computador dormir (cronômetros do navegador param durante o sono).
 */
/** Apaga o horário da última atividade (ao sair ou entrar de novo), para o próximo login não nascer bloqueado. */
export function forgetActivity() { try { localStorage.removeItem("apogeu-last-activity"); localStorage.removeItem("apogeu-snap"); /* o resumo guardado para abrir sem internet também sai */ } catch { /* ok */ } }

export function IdleLock({ minutes = 120 }: { minutes?: number }) {
  const router = useRouter();
  useEffect(() => {
    const KEY = "apogeu-last-activity";
    const limit = minutes * 60 * 1000;
    let locked = false;
    const now = () => Date.now();
    const read = () => { try { return Number(localStorage.getItem(KEY)) || now(); } catch { return mem; } };
    let mem = now();
    const touch = () => { mem = now(); try { localStorage.setItem(KEY, String(mem)); } catch { /* sem armazenamento */ } };
    const lock = async () => {
      if (locked) return;
      locked = true;
      forgetActivity();
      await createClient().auth.signOut({ scope: "local" }); // bloqueia este aparelho; os outros seguem com o próprio tempo
      router.replace("/login?bloqueado=1");
    };
    const check = () => { if (now() - Math.max(read(), mem) >= limit) void lock(); };
    const onActivity = () => { if (now() - Math.max(read(), mem) >= limit) void lock(); else touch(); };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    check(); // abriu a página depois de muito tempo parado
    if (!locked) touch();
    const evs = ["pointerdown", "keydown", "scroll"] as const;
    evs.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    const timer = setInterval(check, 60 * 1000);
    return () => {
      clearInterval(timer);
      evs.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [minutes, router]);
  return null;
}

export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn ghost signout" disabled={busy} aria-busy={busy}
      onClick={async () => { setBusy(true); forgetActivity(); await createClient().auth.signOut(); router.replace("/login?saiu=1"); }}>
      {busy ? "Saindo…" : "Sair"}
    </button>
  );
}
