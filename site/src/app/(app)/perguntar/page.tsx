import Link from "next/link";
import { createClient, requireSession } from "@/lib/supabase/server";
import { answerQuestion, parseQuestion } from "@/lib/phase2";
import { getCategories } from "@/lib/queries";
import { currentNetWorth } from "@/lib/patrimonio";
import { normalizeDesc } from "@/lib/format";
import { brl, dateBR } from "@/lib/format";
import { Topbar } from "@/components/topbar";
import { CAT_COLOR, Icon, Money } from "@/components/ui";
import { VoiceButton, VoiceNote } from "@/components/voice-button";

const EXAMPLES = ["Qual é o meu patrimônio?", "Quanto eu devo?", "Quanto gastei com lazer este mês?"];

// Perguntas em linguagem simples, respondidas por filtros no próprio banco (sem IA externa, grátis e privado).
export default async function Perguntar({ searchParams }: PageProps<"/perguntar">) {
  const s = await requireSession();
  const { q } = (await searchParams) as { q?: string };
  const db = await createClient();
  const cats = await getCategories(db, s.householdId);
  // perguntas de patrimônio ("quanto tenho", "quanto devo", "patrimônio líquido") vão para o cálculo de bens e dívidas
  const nq = normalizeDesc(q ?? "");
  const wealth = !!nq && /(patrimonio|quanto (eu )?tenho|quanto (eu )?devo|minhas dividas|minha divida|quanto valho|bens)/.test(nq) ? (/devo|divida/.test(nq) ? "debts" : "net") : null;
  const nw = wealth ? await currentNetWorth(db, s.householdId) : null;
  const parsed = q?.trim() && !wealth ? parseQuestion(q.slice(0, 200), cats) : null;
  const a = parsed ? await answerQuestion(db, s.householdId, parsed) : null;
  const diff = a && a.prevTotal ? Math.round((a.total / a.prevTotal - 1) * 100) : null;
  const tableHref = parsed ? `/transacoes?mes=${parsed.ym}` : "/transacoes";

  return (
    <>
      <Topbar title="Perguntar" />
      <div className="content page-in grid">
        <form className="card grid" style={{ gap: 14 }} action="/perguntar">
          <label className="f" style={{ fontSize: 15 }}>Pergunte sobre as suas finanças
            <span className="field" style={{ minWidth: 0, height: 48 }}>
              <Icon name="search" size="sm" />
              <input name="q" defaultValue={q ?? ""} placeholder="Ex.: quanto gastei com lazer?" maxLength={200} autoComplete="off"
                style={{ background: "transparent", border: 0, color: "var(--ink)", outline: "none", flex: 1, minWidth: 0, width: "100%", font: "inherit", fontSize: 16 }} />
              <VoiceButton />
            </span>
          </label>
          <VoiceNote />
          <div className="row-flex" style={{ gap: 8 }}>
            {EXAMPLES.map((e) => <Link key={e} className="chip" href={`/perguntar?q=${encodeURIComponent(e)}`}>{e}</Link>)}
          </div>
        </form>

        {nw && (
          <div className="bento">
            <div className="card s5">
              <div className="t-sm muted">Entendi: {wealth === "debts" ? "quanto você deve hoje" : "o seu patrimônio líquido hoje"}</div>
              <div style={{ fontSize: 36, fontWeight: 500, marginTop: 10 }}><Money cents={wealth === "debts" ? nw.liabilities : nw.net} /></div>
              <div className="t-sm ink2" style={{ marginTop: 6 }}>{wealth === "debts" ? "faturas, parcelas a vencer, empréstimos e financiamentos" : <>bens e saldos <span className="money">{brl(nw.assets)}</span> menos dívidas <span className="money">{brl(nw.liabilities)}</span></>}</div>
              <Link className="btn" href="/patrimonio" style={{ marginTop: 16 }}><Icon name="scale" size="sm" />Ver patrimônio</Link>
            </div>
            <div className="card s7">
              <h3>{wealth === "debts" ? "Do que é feita a dívida" : "Do que é feito o patrimônio"}</h3>
              <div className="list" style={{ marginTop: 6 }}>
                {(wealth === "debts"
                  ? [["Faturas de cartão", nw.breakdown.cartao], ["Parcelas a vencer", nw.breakdown.parcelas], ["Empréstimos e financiamentos", nw.breakdown.dividas], ...(nw.breakdown.cash < 0 ? [["Conta no negativo", -nw.breakdown.cash] as [string, number]] : [])]
                  : [["Contas", Math.max(0, nw.breakdown.cash)], ["Investimentos", nw.breakdown.investimento], ["Bens", nw.breakdown.bens], ["Dívidas", -nw.liabilities]]
                ).map(([label, cents]) => (
                  <div className="row" key={label as string} style={{ gridTemplateColumns: "1fr auto" }}><span>{label}</span><Money cents={cents as number} color={(cents as number) < 0} /></div>
                ))}
              </div>
            </div>
          </div>
        )}
        {parsed && a && (
          <div className="bento">
            <div className="card s5">
              <div className="t-sm muted">Entendi: {parsed.understood}</div>
              <div style={{ fontSize: 36, fontWeight: 500, marginTop: 10 }} className={parsed.kind === "income" ? "in" : ""}><Money cents={a.total} /></div>
              <div className="t-sm ink2" style={{ marginTop: 6 }}>
                {a.count} {a.count === 1 ? "lançamento" : "lançamentos"}
                {diff !== null && <> · <span className={parsed.kind === "expense" ? (diff > 0 ? "out" : "in") : diff > 0 ? "in" : "out"}>{diff > 0 ? "▲" : "▼"} {Math.abs(diff)}%</span> vs. mês anterior (<span className="money">{brl(a.prevTotal)}</span>)</>}
              </div>
              <Link className="btn" href={tableHref} style={{ marginTop: 16 }}><Icon name="table" size="sm" />Ver na tabela</Link>
            </div>
            <div className="card s7">
              <h3>{parsed.top ? "Maiores lançamentos" : "Principais lançamentos"}</h3>
              <div className="list" style={{ marginTop: 6 }}>
                {a.top.map((t, k) => {
                  const c = a.cats.find((x) => x.id === t.category_id);
                  return (
                    <div className="row" key={t.id + k}>
                      <span className="ico-box" style={{ color: CAT_COLOR(c?.color ?? null) }}><Icon name={c?.icon ?? "dots"} /></span>
                      <div><div>{t.description}</div><div className="t-xs muted">{c?.name ?? "Sem categoria"} · {dateBR(t.occurred_at)}</div></div>
                      <Money cents={parsed.kind === "income" ? t.cents : -t.cents} color />
                    </div>
                  );
                })}
                {!a.top.length && <span className="ink2 t-sm">Nada encontrado com esse filtro.</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
