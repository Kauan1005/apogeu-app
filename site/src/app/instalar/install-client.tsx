"use client";
import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui";

type Os = "android" | "ios";
const detect = (): Os => (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "ios" : "android");

const Share = () => (
  <svg className="inline-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Compartilhar" role="img">
    <path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);

/** Passo a passo de instalação: abre no sistema do aparelho; dá para trocar. */
export function InstallGuide({ apkSize }: { apkSize: string }) {
  const detected = useSyncExternalStore(() => () => {}, detect, () => "android" as Os);
  const [pick, setPick] = useState<Os | null>(null);
  const os = pick ?? detected;
  return (
    <>
      <div className="os-tabs" role="tablist" aria-label="Sistema do celular">
        {(["android", "ios"] as Os[]).map((o) => (
          <button key={o} role="tab" aria-selected={os === o} className={os === o ? "on" : ""} onClick={() => setPick(o)}>{o === "android" ? "Android" : "iPhone"}</button>
        ))}
      </div>

      {os === "android" ? (
        <section aria-label="Instalar no Android">
          <ol className="steps">
            <li><div><b>Baixe o app.</b><br /><a className="btn primary dl" href="/apogeu.apk" download="apogeu.apk"><Icon name="download" size="sm" />Baixar o Apogeu ({apkSize})</a></div></li>
            <li><div><b>Abra o arquivo baixado.</b> Se o Android pedir, permita instalar apps vindos desse navegador (é uma vez só).</div></li>
            <li><div><b>Toque em Instalar</b> e abra o Apogeu pelo ícone novo.</div></li>
          </ol>
          <p className="muted t-sm">Abre em tela cheia, sem barra de endereço, e já aceita o aviso de conta que vence amanhã. Prefere não instalar um arquivo? No Chrome, toque em ⋮ e depois em <b>Instalar app</b>.</p>
        </section>
      ) : (
        <section aria-label="Instalar no iPhone">
          <ol className="steps">
            <li><div><b>Abra este endereço no Safari.</b> Tem que ser o Safari: outros navegadores no iPhone não instalam apps.</div></li>
            <li><div><b>Toque em Compartilhar</b> <Share /> na barra de baixo.</div></li>
            <li><div><b>Role e toque em “Adicionar à Tela de Início”</b> e depois em <b>Adicionar</b>. Se aparecer “Abrir como app da Web”, deixe ligado.</div></li>
            <li><div><b>Abra pelo ícone novo.</b> Fica em tela cheia, sem a barra do Safari, e o login continua salvo.</div></li>
          </ol>
          <p className="muted t-sm">Para receber o aviso de conta que vence amanhã (iOS 16.4 ou mais novo), abra o app pelo ícone, entre em <b>Contas a pagar</b> e toque no sino. O aviso só funciona pelo ícone, não pelo Safari.</p>
        </section>
      )}
    </>
  );
}
