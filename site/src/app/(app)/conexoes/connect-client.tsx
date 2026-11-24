"use client";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";

const PluggyConnect = dynamic(() => import("react-pluggy-connect").then((m) => m.PluggyConnect), { ssr: false });

/** Conector "MeuPluggy" da Pluggy (id 200): no plano grátis é o caminho para bancos reais. */
export const MEU_PLUGGY_CONNECTOR = 200;

export function ConnectBank({ sandbox, itemId, label = "Conectar banco", next = "/conexoes", onOpenChange }: { sandbox: boolean; itemId?: string; label?: string; next?: string; onOpenChange?: (open: boolean) => void }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const open = () => start(async () => {
    setMsg("");
    const res = await fetch("/api/pluggy/connect-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId }) });
    if (res.status === 403) { router.push(`/mfa?reauth=1&next=${encodeURIComponent(next)}`); return; }
    if (res.status === 409) { setMsg("Cadastre antes a sua conta Meu Pluggy em Ajustes."); return; }
    if (!res.ok) { setMsg("Não foi possível abrir a conexão. Confira as chaves da Pluggy."); return; }
    setToken((await res.json()).accessToken);
    onOpenChange?.(true);
  });

  return (
    <>
      <button className="btn primary" onClick={open} disabled={pending}><Icon name="plus" size="sm" />{pending ? "Abrindo…" : label}</button>
      {msg && <span className="err" role="alert">{msg}</span>}
      {token && (
        <PluggyConnect
          connectToken={token}
          includeSandbox={sandbox}
          updateItem={itemId}
          theme="dark"
          // em produção vai direto para o login do Meu Pluggy, sem a lista de bancos (bancos reais no plano grátis)
          {...(sandbox || itemId ? {} : { connectorIds: [MEU_PLUGGY_CONNECTOR], selectedConnectorId: MEU_PLUGGY_CONNECTOR })}
          onSuccess={async ({ item }) => {
            setToken(null);
            onOpenChange?.(false);
            setMsg("Importando…");
            const r = await fetch("/api/pluggy/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: item.id }) });
            const j = await r.json().catch(() => ({}));
            setMsg(r.ok ? (j.partial ? `Importando: ${j.inserted ?? 0} transações até agora. Toque em Sincronizar agora para continuar.` : `Conectado! ${j.inserted ?? 0} transações importadas, ${j.review ?? 0} para revisar.`) : "A conexão foi criada, mas a importação falhou. Tente “Sincronizar agora”.");
            router.refresh();
          }}
          onError={() => setMsg("A conexão não foi concluída.")}
          onClose={() => { setToken(null); onOpenChange?.(false); setMsg("Se a lista de contas estava vazia, toque em Conectar banco no Meu Pluggy primeiro e depois autorize de novo aqui."); }}
        />
      )}
    </>
  );
}

export function SyncNow() {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      {msg && <span className="t-sm ink2" role="status">{msg}</span>}
      <button className="btn" disabled={pending} onClick={() => start(async () => {
        const r = await fetch("/api/pluggy/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        const j = await r.json().catch(() => ({}));
        setMsg(r.ok ? (j.partial ? `${j.inserted ?? 0} novas até agora. Toque de novo para continuar.` : `${j.inserted ?? 0} novas · ${j.updated ?? 0} alteradas`) : "Falha ao sincronizar");
        router.refresh();
      })}><Icon name="refresh" size="sm" />{pending ? "Sincronizando…" : "Sincronizar agora"}</button>
    </>
  );
}

/** Simulador de Pix (só em desenvolvimento): entra pelo mesmo caminho da importação real. */
export function Simulator() {
  const router = useRouter();
  const [res, setRes] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="card">
      <h3><Icon name="pix" size="sm" />Simular um Pix ou compra no cartão (teste)</h3>
      <form className="row-flex" style={{ marginTop: 14, alignItems: "end" }} onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const r = await fetch("/api/dev/simulate-pix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
            name: f.get("name"), amount: Number(String(f.get("amount")).replace(",", ".")), direction: f.get("direction") === "card" ? "out" : f.get("direction"), cpf: f.get("cpf") || undefined,
            card: f.get("direction") === "card", installments: f.get("direction") === "card" ? Number(f.get("installments") || 1) : undefined,
          }) });
          const j = await r.json().catch(() => ({}));
          const t = j.transaction;
          setRes(r.ok && t ? `Entrou e foi categorizado como ${t.categories?.name ?? "—"} (${Math.round((t.confidence ?? 0) * 100)}%, ${t.status === "review" ? "vai para revisar" : "confirmado"}).` : "Falhou: " + (j.error ?? r.status));
          router.refresh();
        });
      }}>
        <label className="f" style={{ flex: "2 1 200px" }}>Destinatário<input className="input" name="name" required defaultValue="Uber Trip" /></label>
        <label className="f" style={{ flex: "1 1 110px" }}>Valor (R$)<input className="input" name="amount" required defaultValue="23,90" inputMode="decimal" /></label>
        <label className="f" style={{ flex: "1 1 130px" }}>Tipo<select className="input" name="direction" defaultValue="out"><option value="out">Pix enviado</option><option value="in">Pix recebido</option><option value="card">Compra no cartão</option></select></label>
        <label className="f" style={{ flex: "0 1 110px" }}>Parcelas (cartão)<input className="input" name="installments" type="number" min={1} max={24} defaultValue={1} /></label>
        <label className="f" style={{ flex: "1 1 150px" }}>CPF fictício (opcional)<input className="input" name="cpf" inputMode="numeric" pattern="\d{11}" placeholder="11 dígitos" /></label>
        <button className="btn primary" disabled={pending} style={{ height: 40 }}>{pending ? "Enviando…" : "Simular Pix"}</button>
      </form>
      {res && <p className="t-sm ink2" role="status" style={{ marginTop: 10 }}>{res}</p>}
    </div>
  );
}
