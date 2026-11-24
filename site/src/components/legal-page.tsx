import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

/** Moldura das páginas públicas de texto (privacidade, termos): leitura confortável, sem a barra do app. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="legal">
      <div className="row-flex"><Link className="brand" href="/" style={{ padding: 0 }}><Brand /></Link><span className="sp" /><Link className="link t-sm" href="/">Voltar ao Apogeu</Link></div>
      <h1>{title}</h1>
      <p className="muted t-sm">Atualizada em {updated}</p>
      {children}
      <footer className="t-sm muted">
        <Link className="link" href="/privacidade">Política de privacidade</Link> · <Link className="link" href="/termos">Termos de uso</Link> · <Link className="link" href="/login">Entrar</Link>
      </footer>
    </main>
  );
}

/** Links discretos para rodapés de login, cadastro e Ajustes. */
export function LegalLinks() {
  return (
    <span className="t-xs muted"><Link className="link" href="/privacidade">Privacidade</Link> · <Link className="link" href="/termos">Termos</Link></span>
  );
}
