"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";
import { PluggyCredentialsForm } from "../ajustes/access-client";
import { ConnectBank } from "../conexoes/connect-client";

const KEY = "fluxo-onboarding"; // só lembra no navegador quais passos externos a pessoa marcou como feitos
const MEU = "https://meu.pluggy.ai", DASH = "https://dashboard.pluggy.ai";

/** Abre o site da Pluggy numa janela ao lado (no computador); no celular, numa aba nova. */
function openSide(url: string) {
  if (typeof window === "undefined") return;
  if (window.innerWidth < 900) { window.open(url, "_blank", "noopener"); return; }
  const w = Math.min(560, Math.round(window.screen.availWidth * 0.4));
  const left = window.screen.availWidth - w;
  window.open(url, "pluggy", `popup=yes,width=${w},height=${window.screen.availHeight},left=${left},top=0,noopener`);
}

/** Botão que abre a Pluggy ao lado (com link de verdade para quem prefere abrir em aba). */
function SideLink({ url, children, primary }: { url: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <a className={`btn${primary ? " primary" : ""}`} href={url} target="_blank" rel="noopener noreferrer"
      onClick={(e) => { if (window.innerWidth >= 900) { e.preventDefault(); openSide(url); } }}>
      <Icon name="link" size="sm" />{children}
    </a>
  );
}

/** Ilustração (esquemática, não é a tela real) de onde clicar no painel da Pluggy. */
function DashboardHint() {
  return (
    <div className="dash-hint" role="img" aria-label="Ilustração: no painel da Pluggy, clique em Applications, copie o Client ID e gere o Client Secret">
      <div className="dh-side"><span className="dh-item">Home</span><span className="dh-item dh-a1">Applications</span><span className="dh-item">Customization</span></div>
      <div className="dh-main">
        <div className="dh-row"><span className="dh-label">Minha aplicação</span><span className="dh-id dh-a2">Client ID 3f2a…9c1e <span className="dh-copy">copiar</span></span></div>
        <span className="dh-btn dh-a3">Generate new secret</span>
        <span className="dh-secret dh-a4">Client Secret 7b0d…44af · aparece uma vez</span>
      </div>
      <span className="dh-cursor" aria-hidden="true" />
    </div>
  );
}

type Props = { hasCreds: boolean; credHint: string | null; banks: number; owner: boolean };

export function Onboarding({ hasCreds, credHint, banks, owner }: Props) {
  const [marked, setMarked] = useState<Record<string, boolean>>({});
  // lê o navegador só depois de montar (o HTML do servidor não conhece o localStorage)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { setMarked(JSON.parse(localStorage.getItem(KEY) ?? "{}")); } catch { /* sem armazenamento */ } }, []);
  const mark = (k: string, v = true) => setMarked((m) => { const n = { ...m, [k]: v }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* ok */ } return n; });

  // passos 3 e 4 vêm do servidor (chaves salvas, bancos conectados); 1 e 2 a pessoa confirma
  const done = [!!marked.conta || hasCreds, !!marked.bancos || hasCreds, hasCreds, banks > 0];
  const current = done.findIndex((d) => !d);
  const [open, setOpen] = useState<number | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const router = useRouter();
  useEffect(() => {
    // com a janela da Pluggy aberta não atualiza (atualizar no meio fecharia a conexão)
    const again = () => { if (document.visibilityState === "visible" && !widgetOpen) router.refresh(); };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); };
  }, [router, widgetOpen]);
  const shown = open ?? (current === -1 ? 3 : current);

  const steps = [
    {
      title: "Crie sua conta grátis no Meu Pluggy",
      body: (
        <>
          <p>O Meu Pluggy é o serviço da Pluggy (empresa autorizada no Open Finance) que busca os dados nos seus bancos. É gratuito para uso pessoal e conecta até <b>5 bancos</b>.</p>
          <div className="row-flex">
            <SideLink url={MEU} primary>Abrir o Meu Pluggy ao lado</SideLink>
            <button className="btn" onClick={() => { mark("conta"); setOpen(null); }}><Icon name="check" size="sm" />Já criei a conta</button>
          </div>
        </>
      ),
    },
    {
      title: "Conecte seus bancos no Meu Pluggy",
      body: (
        <>
          <p>Dentro do Meu Pluggy, adicione cada banco. A autorização acontece no app do próprio banco, pelo Open Finance: você nunca digita a senha do banco no Apogeu nem no Meu Pluggy.</p>
          <ol className="steps-ol">
            <li>No Meu Pluggy, toque em adicionar conta e escolha o banco.</li>
            <li>Confirme no app do banco (vale por 12 meses).</li>
            <li>Repita para cada banco, até 5.</li>
          </ol>
          <div className="row-flex">
            <SideLink url={MEU}>Abrir o Meu Pluggy ao lado</SideLink>
            <button className="btn primary" onClick={() => { mark("bancos"); setOpen(null); }}><Icon name="check" size="sm" />Já conectei meus bancos</button>
          </div>
        </>
      ),
    },
    {
      title: "Cole suas chaves da Pluggy",
      body: (
        <>
          <p>As chaves deixam o Apogeu ler os dados da <b>sua</b> conta. Elas ficam guardadas cifradas e só o servidor usa.</p>
          <ol className="steps-ol">
            <li>Abra o Pluggy Dashboard e entre com a <b>mesma conta</b> do Meu Pluggy.</li>
            <li>Vá em <b>Applications</b> (Aplicações). Na linha da sua aplicação está o <b>Client ID</b>: copie.</li>
            <li>Gere o <b>Client Secret</b> (“Generate new secret”). Ele aparece <b>uma vez só</b>: copie antes de fechar.</li>
            <li>Volte aqui e toque em <b>Colar</b> em cada campo. Com os dois colados, o Apogeu confere sozinho na Pluggy.</li>
          </ol>
          <DashboardHint />
          <div className="row-flex"><SideLink url={DASH} primary>Abrir o Pluggy Dashboard ao lado</SideLink></div>
          {hasCreds && <p className="ok-msg"><Icon name="check" size="sm" /> Chaves salvas (Client ID terminando em <span className="mono">{credHint}</span>). Pode trocar se precisar.</p>}
          {owner ? <PluggyCredentialsForm configured={hasCreds} next="/comecar" /> : <p className="t-sm muted">Só o dono da conta cadastra as chaves.</p>}
        </>
      ),
    },
    {
      title: "Traga seus bancos para o Apogeu",
      body: hasCreds ? (
        <>
          <p>Último passo, aqui mesmo no Apogeu: entre com a sua conta Meu Pluggy na janela da Pluggy e autorize. Todos os bancos que você conectou lá chegam para cá.</p>
          <div className="row-flex">
            <ConnectBank sandbox={false} label="Entrar com Meu Pluggy" next="/comecar" onOpenChange={setWidgetOpen} />
          </div>
          <p className="t-xs muted">Quer adicionar outro banco depois? Ele é adicionado no Meu Pluggy (<SideInline url={MEU}>abrir ao lado</SideInline>) e aparece aqui sozinho.</p>
          <details className="onb-alt">
            <summary>Prefere colar o ID do banco?</summary>
            <p className="t-sm ink2">No Pluggy Dashboard: Applications → sua aplicação → <b>Demo</b> → Connect Account → MeuPluggy. Em Connected Items, copie o ID de cada banco e cole aqui.</p>
            <ItemForm />
          </details>
          {banks > 0 && <p className="ok-msg" style={{ marginTop: 12 }}><Icon name="check" size="sm" /> {banks} {banks === 1 ? "banco conectado" : "bancos conectados"}.</p>}
        </>
      ) : <p className="t-sm muted">Primeiro cole as chaves no passo 3.</p>,
    },
  ];

  if (current === -1 && open === null && !widgetOpen) {
    return (
      <div className="card onb-done">
        <Icon name="check" size="lg" />
        <h2>Tudo pronto</h2>
        <p className="ink2">Seus bancos estão conectados. Os dados chegam em alguns minutos e atualizam sozinhos uma vez por dia. As categorias são sugeridas automaticamente: confira as que ficarem em Revisar.</p>
        <div className="row-flex" style={{ justifyContent: "center" }}>
          <Link className="btn primary" href="/">Ir para o painel</Link>
          <button className="btn" onClick={() => setOpen(3)}>Conectar outro banco</button>
        </div>
      </div>
    );
  }

  return (
    <div className="onb">
      <div className="onb-progress" aria-label={`Passo ${Math.min(shown + 1, 4)} de 4`}>
        {steps.map((_, i) => <span key={i} className={done[i] ? "ok" : i === shown ? "on" : ""} />)}
      </div>
      {steps.map((st, i) => (
        <section key={i} className={`card onb-step${i === shown ? " open" : ""}${done[i] ? " done" : ""}`}>
          <button className="onb-head" onClick={() => setOpen(i === shown ? -1 : i)} aria-expanded={i === shown}>
            <span className="onb-num">{done[i] ? <Icon name="check" size="sm" /> : i + 1}</span>
            <span className="onb-title">{st.title}</span>
            <Icon name="chevdown" size="sm" />
          </button>
          {i === shown && <div className="onb-body">{st.body}</div>}
        </section>
      ))}
      <p className="t-xs muted">Dúvidas sobre o Meu Pluggy: meu-suporte@pluggy.ai. O consentimento de cada banco vale 12 meses; o Apogeu avisa 15 dias antes de vencer.</p>
    </div>
  );
}

function SideInline({ url, children }: { url: string; children: React.ReactNode }) {
  return <a className="link" href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (window.innerWidth >= 900) { e.preventDefault(); openSide(url); } }}>{children}</a>;
}

/** Cola o ID de um item criado pelo Pluggy Dashboard (Demo → Connected Items). */
function ItemForm() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="row-flex" style={{ marginTop: 8 }} onSubmit={(e) => {
      e.preventDefault();
      const itemId = id.trim();
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) return setMsg({ text: "O ID tem o formato 00000000-0000-0000-0000-000000000000." });
      start(async () => {
        setMsg({ ok: true, text: "Importando…" });
        const r = await fetch("/api/pluggy/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId }) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 403) return setMsg({ text: j.error === "forbidden" ? "Esse banco não pode ser trazido para esta conta." : "Confirme o 2FA e tente de novo." });
        if (!r.ok) return setMsg({ text: j.message ?? "Não foi possível importar. Confira o ID." });
        setMsg({ ok: true, text: `Banco conectado: ${j.inserted ?? 0} transações importadas.` });
        setId("");
        router.refresh();
      });
    }}>
      <input className="input mono" style={{ flex: "1 1 260px", minWidth: 0 }} aria-label="ID do item" placeholder="ID do item (Connected Items)" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} />
      <button className="btn" disabled={pending}>{pending ? "Importando…" : "Adicionar"}</button>
      {msg && <span className={msg.ok ? "ok-msg" : "err"} role={msg.ok ? "status" : "alert"} style={{ flexBasis: "100%" }}>{msg.text}</span>}
    </form>
  );
}
