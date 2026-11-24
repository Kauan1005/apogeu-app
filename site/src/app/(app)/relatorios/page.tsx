import Link from "next/link";
import { createClient, requireSession } from "@/lib/supabase/server";
import { buildIr, type Party } from "@/lib/ir";
import { Topbar } from "@/components/topbar";
import { Icon, Money } from "@/components/ui";

const maskDocShown = (d: string | null) => (d ? d.replace(/\d(?=(?:\D*\d){2})/g, (c, i) => (i < 3 ? c : "•")) : "documento não identificado");

export default async function Relatorios({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requireSession();
  const thisYear = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 4));
  const { ano } = (await searchParams) as { ano?: string };
  // sem ano escolhido: ano passado (o da declaração) se tiver dados; senão o ano atual
  let year = Number(ano) >= 2000 && Number(ano) <= thisYear ? Number(ano) : thisYear - 1;
  const db = await createClient();
  let r = await buildIr(db, s.householdId, year);
  if (!ano && r.txCount === 0) { year = thisYear; r = await buildIr(db, s.householdId, year); }
  const sum = (ps: Party[]) => ps.reduce((a, p) => a + p.cents, 0);
  const years = [thisYear, thisYear - 1, thisYear - 2];

  return (
    <>
      <Topbar title="Relatórios" />
      <div className="content page-in grid">
        <div className="bento">
          <div className="card s12">
            <h3><Icon name="file" size="sm" />Resumo para o Imposto de Renda<span className="sp" />
              <span className="seg" role="group" aria-label="Ano-calendário">
                {years.map((y) => <Link key={y} href={`/relatorios?ano=${y}`} className={y === year ? "on" : ""} aria-current={y === year ? "page" : undefined}>{y}</Link>)}
              </span>
            </h3>
            <p className="ink2 t-sm" style={{ marginTop: 10, maxWidth: 720 }}>
              Ano-calendário {year} (declaração de {year + 1}). O PDF traz saldos em 31/12, bens e dívidas, rendimentos por fonte pagadora e os pagamentos de saúde e educação com o CPF/CNPJ de quem recebeu. Confira sempre com os informes oficiais.
            </p>
            <div className="row-flex" style={{ marginTop: 16 }}>
              <a className="btn primary" href={`/api/relatorio/ir?ano=${year}`} download><Icon name="download" size="sm" />Baixar PDF de {year}</a>
              <span className="t-xs muted">Vamos pedir o código do app autenticador se o último tiver mais de 15 minutos.</span>
            </div>
            {r.assets.some((a) => a.acquisition_cents == null) && <p className="t-xs muted" style={{ marginTop: 12 }}><Icon name="alert" size="sm" /> {(() => { const n = r.assets.filter((a) => a.acquisition_cents == null).length; return n === 1 ? "1 bem sem o valor pago." : `${n} bens sem o valor pago.`; })()} O IR declara pelo custo de aquisição: preencha em <a href="/patrimonio">Patrimônio</a>.</p>}
            {!r.coverageOk && r.txCount > 0 && <p className="t-xs muted" style={{ marginTop: 12 }}><Icon name="alert" size="sm" /> O histórico importado não cobre o ano inteiro; os saldos em 31/12/{year - 1} são estimados.</p>}
          </div>

          <div className="card kpi s3"><h3><Icon name="arrowin" size="sm" />Entradas no ano</h3><div className="v"><Money cents={r.totalIn} /></div><div className="d">sem transferências entre contas</div></div>
          <div className="card kpi s3"><h3><Icon name="arrowout" size="sm" />Gastos no ano</h3><div className="v"><Money cents={r.totalOut} /></div><div className="d">{r.txCount} transações</div></div>
          <div className="card kpi s3"><h3><Icon name="health" size="sm" />Saúde dedutível</h3><div className="v"><Money cents={Math.max(0, sum(r.deductible.saude) - sum(r.deductible.reembolsos))} /></div><div className="d">{r.deductible.saude.length} {r.deductible.saude.length === 1 ? "prestador" : "prestadores"}</div></div>
          <div className="card kpi s3"><h3><Icon name="edu" size="sm" />Educação</h3><div className="v"><Money cents={sum(r.deductible.educacao)} /></div><div className="d">{r.deductible.educacao.length} {r.deductible.educacao.length === 1 ? "instituição" : "instituições"}</div></div>

          <PartyCard title="Rendimentos por fonte pagadora" icon="wallet" ps={[...r.income.salario, ...r.income.rendimentos]} empty="Nenhuma entrada em Salário ou Rendimentos neste ano." />
          <PartyCard title="Saúde e educação por prestador" icon="health" ps={[...r.deductible.saude, ...r.deductible.educacao].sort((a, b) => b.cents - a.cents)} empty="Nenhum gasto dedutível em Saúde ou Educação neste ano." />
          <PartyCard title="Recebidos de pessoas físicas (carnê-leão)" icon="users" ps={r.carneLeao.parties} empty="Nenhum recebimento de pessoa física identificado." />
          <PartyCard title="Previdência, pensão e farmácia" icon="receipt" ps={[...r.deductible.previdencia.map((p) => ({ ...p, name: `${p.name} · previdência` })), ...r.deductible.pensao.map((p) => ({ ...p, name: `${p.name} · pensão` })), ...r.naoDedutivel.farmacia.map((p) => ({ ...p, name: `${p.name} · farmácia (não dedutível)` }))]} empty="Nada identificado neste ano." />

          <div className="card s12">
            <h3><Icon name="landmark" size="sm" />Saldos em conta</h3>
            <div className="list" style={{ marginTop: 6 }}>
              {r.balances.map((b) => (
                <div className="row bal-row" key={b.institution + b.name}>
                  <div>{b.institution} · {b.name} <span className="muted">{b.number}</span></div>
                  <span className="t-sm"><span className="muted">31/12/{year - 1} </span><Money cents={b.prev} /></span>
                  <span className="t-sm"><span className="muted">31/12/{year} </span><Money cents={b.end} /></span>
                </div>
              ))}
              {!r.balances.length && <p className="ink2 t-sm">Nenhuma conta corrente ou poupança conectada.</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function PartyCard({ title, icon, ps, empty }: { title: string; icon: string; ps: Party[]; empty: string }) {
  return (
    <div className="card s6">
      <h3><Icon name={icon} size="sm" />{title}</h3>
      <div className="list" style={{ marginTop: 6 }}>
        {ps.slice(0, 8).map((p, i) => (
          <div className="row" key={i} style={{ gridTemplateColumns: "1fr auto" }}>
            <div style={{ minWidth: 0 }}><div>{p.name}</div><div className="t-xs muted">{maskDocShown(p.doc)} · {p.count} {p.count === 1 ? "lançamento" : "lançamentos"}</div></div>
            <Money cents={p.cents} />
          </div>
        ))}
        {ps.length > 8 && <p className="t-xs muted" style={{ paddingTop: 8 }}>+ {ps.length - 8} no PDF</p>}
        {!ps.length && <p className="ink2 t-sm" style={{ padding: "12px 0" }}>{empty}</p>}
      </div>
    </div>
  );
}
