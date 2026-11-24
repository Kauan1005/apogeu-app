import { createClient, createServiceClient, requireSession } from "@/lib/supabase/server";
import { canManageConnection, householdPeople } from "@/lib/people";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { BankBadge, BankTile, Icon, Money } from "@/components/ui";
import { bankColor } from "@/lib/banks";
import { dateBR, todayBR } from "@/lib/format";
import { ConnectBank, Simulator, SyncNow } from "./connect-client";
import { DisconnectButton } from "../ajustes/ajustes-client";
import { StatementImport } from "./statement-import";

// a importação de extrato grava em partes, cada uma dentro deste limite
export const maxDuration = 60;

export default async function Conexoes() {
  const s = await requireSession();
  const db = await createClient();
  const [{ data: conns }, { data: accs }] = await Promise.all([
    db.from("connections").select("id, provider_item_id, institution, status, error, consent_expires_at, last_synced_at, created_by").eq("household_id", s.householdId).order("created_at"),
    db.from("accounts").select("id, connection_id, name, type, institution, number_masked, balance_cents, credit_limit_cents").eq("household_id", s.householdId).order("name"),
  ]);
  const people = await householdPeople(createServiceClient(), s.householdId);
  const who = (id: string | null) => (id === s.userId ? "você" : people.find((p) => p.id === id)?.email ?? "dono da conta");
  const multi = people.length > 1;
  const svc = createServiceClient();
  const [{ data: hh }, { data: cred }] = await Promise.all([
    svc.from("households").select("uses_app_pluggy").eq("id", s.householdId).single(),
    svc.from("pluggy_credentials").select("household_id").eq("household_id", s.householdId).maybeSingle(),
  ]);
  const needsCreds = !hh?.uses_app_pluggy && !cred;
  const sandbox = process.env.NODE_ENV !== "production";
  const meuPluggy = (conns ?? []).find((c) => /meu ?pluggy/i.test(c.institution ?? ""));
  const hasMeuPluggy = !!meuPluggy;
  const addMore = !!meuPluggy && !sandbox; // com o Meu Pluggy já autorizado, o botão passa a "Adicionar bancos" (nova autorização, só para os bancos novos)
  const simulator = sandbox && process.env.ENABLE_DEV_SIMULATOR === "true";
  const limit = new Date(todayBR() + "T12:00:00").getTime() + 15 * 864e5; // renovar 15 dias antes
  const soon = (iso: string | null) => !!iso && new Date(iso).getTime() < limit;

  return (
    <>
      <Topbar title="Conexões"><SyncNow />{needsCreds ? <Link className="btn primary" href="/comecar"><Icon name="plus" size="sm" />Conectar banco</Link> : <ConnectBank sandbox={sandbox} label={sandbox ? "Conectar banco" : addMore ? "Adicionar bancos" : "Conectar com Meu Pluggy"} />}</Topbar>
      <div className="content page-in grid">
        {!needsCreds && !sandbox && (
          <details className="card how" open={!hasMeuPluggy}>
            <summary><Icon name="flag" size="sm" />{hasMeuPluggy ? "Como adicionar outro banco" : "Como conectar seus bancos"}</summary>
            {hasMeuPluggy ? (
              <ol className="steps" style={{ marginTop: 16, marginBottom: 12 }}>
                <li><div>No <a className="link" href="https://meu.pluggy.ai" target="_blank" rel="noopener noreferrer">Meu Pluggy</a>, toque em <b>Conectar banco</b>, escolha o banco e autorize no app dele.</div></li>
                <li><div>Volte aqui e toque em <b>Adicionar bancos</b> (no topo).</div></li>
                <li><div>Entre no Meu Pluggy e marque as contas novas que o Apogeu pode ler.</div></li>
              </ol>
            ) : (
              <ol className="steps" style={{ marginTop: 16, marginBottom: 12 }}>
                <li><div>Toque em <b>Conectar com Meu Pluggy</b> (no topo) e entre na sua conta do Meu Pluggy.</div></li>
                <li><div>No Meu Pluggy, toque em <b>Conectar banco</b>, escolha o seu banco e autorize no app dele.</div></li>
                <li><div>Volte aqui e toque em <b>Conectar com Meu Pluggy</b> de novo para marcar as contas que o Apogeu pode ler.</div></li>
              </ol>
            )}
            <p className="t-sm ink2">Dica: <b>é mais fácil pelo celular</b>. O app do banco abre direto e normalmente não pede QR code. Cada banco só precisa disso uma vez.</p>
          </details>
        )}
        <div className="card">
          <h3><Icon name="lock" size="sm" />Como a conexão funciona</h3>
          <p className="ink2" style={{ marginTop: 10, maxWidth: 760 }}>
            A autorização acontece no app do seu banco, pelo fluxo oficial do Open Finance. O Apogeu nunca vê nem guarda a sua senha.
            Os dados chegam pela Pluggy uma vez por dia e o consentimento vale 12 meses; avisamos 15 dias antes de vencer.
            {sandbox && " Ambiente de testes: use os bancos de sandbox da Pluggy (dados fictícios)."}
          </p>
        </div>

        {needsCreds && (
          <div className="card" style={{ borderColor: "rgba(229,166,59,.4)" }}>
            <h3 style={{ color: "var(--warning)" }}><Icon name="alert" size="sm" />Falta a sua conta Meu Pluggy</h3>
            <p className="ink2" style={{ marginTop: 10, maxWidth: 760 }}>Para conectar bancos, siga o passo a passo: criar a conta grátis no Meu Pluggy, conectar seus bancos lá e colar as chaves aqui. Leva uns 5 minutos, e os seus 5 bancos ficam só seus.</p>
            <Link className="btn primary" href="/comecar" style={{ marginTop: 14 }}><Icon name="flag" size="sm" />Começar o passo a passo</Link>
          </div>
        )}
        {(conns ?? []).map((c) => {
          const mine = (accs ?? []).filter((a) => a.connection_id === c.id);
          // o cartão ("VISA PLATINUM") não diz o banco: usa a cor do banco das outras contas da mesma autorização
          const brand = bankColor(...mine.map((a) => a.name), c.institution);
          // o logo do topo é o do banco (pelo nome das contas); a autorização em si se chama "MeuPluggy"
          const bankName = mine.find((a) => bankColor(a.name))?.name ?? c.institution;
          return (
          <div className="card" key={c.id}>
            <div className="row-flex">
              <BankBadge name={bankName} color={brand} size="lg" />
              <div><div style={{ fontWeight: 500 }}>{/meu ?pluggy/i.test(c.institution ?? "") ? "Autorização do Meu Pluggy" : c.institution ?? "Instituição"}</div>
                <div className="t-xs muted">{c.last_synced_at ? `Sincronizado em ${dateBR(c.last_synced_at, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Aguardando primeira sincronização"}{c.consent_expires_at ? ` · consentimento até ${dateBR(c.consent_expires_at, { day: "2-digit", month: "2-digit", year: "numeric" })}` : ""}{multi ? ` · conectado por ${who(c.created_by)}` : ""}</div></div>
              <span className="sp" />
              {c.error || ["LOGIN_ERROR", "OUTDATED"].includes(c.status ?? "") ? <span className="st late"><Icon name="alert" size="sm" />{c.error ?? "Reconexão necessária"}</span>
                : soon(c.consent_expires_at) && canManageConnection(c, s) ? <ConnectBank sandbox={sandbox} itemId={c.provider_item_id} label="Renovar conexão" />
                : <span className="st paid"><Icon name="check" size="sm" />Ativa</span>}
              {canManageConnection(c, s) && <DisconnectButton id={c.id} name={c.institution ?? "esta instituição"} />}
            </div>
            <div className="list" style={{ marginTop: 12 }}>
              {mine.map((a) => {
                const color = bankColor(a.name) ?? brand; // o nome da conta manda; o que não diz o banco (cartão) herda da autorização
                return (
                <div className="row" key={a.id} style={{ gridTemplateColumns: "36px 1fr auto" }}>
                  {color ? <BankBadge name={null} color={color} /> : <span className="ico-box"><Icon name={a.type === "credit" ? "card" : "wallet"} /></span>}
                  <div><div className={color ? "bank-name" : undefined} style={color ? ({ "--bank": color } as React.CSSProperties) : undefined}>{a.name}</div><div className="t-xs muted">{a.type === "credit" ? "Cartão de crédito" : a.type === "savings" ? "Poupança" : "Conta"} {a.number_masked ?? ""}</div></div>
                  <Money cents={a.balance_cents} />
                </div>
                );
              })}
            </div>
          </div>
          );
        })}
        {!conns?.length && (
          <div className="card empty"><Icon name="link" size="lg" /><div style={{ fontSize: 18, fontWeight: 500 }}>Nenhum banco conectado</div><div className="ink2">Limite do plano gratuito do Meu Pluggy: 5 instituições.</div><ConnectBank sandbox={sandbox} /></div>
        )}

        <StatementImport accountNames={(accs ?? []).filter((a) => a.institution === "Importado").map((a) => a.name as string)} />

        {simulator && <Simulator />}
      </div>
    </>
  );
}
