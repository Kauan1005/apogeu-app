import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCategories } from "./queries";
import { normalizeDesc } from "./format";
import { decrypt, formatDoc } from "./crypto";
import type { Holding } from "./patrimonio";

// Resumo do ano para ajudar a preencher a declaração do IR. Não substitui os informes oficiais.

type Tx = {
  account_id: string; occurred_at: string; amount_cents: number; description: string; category_id: string | null;
  counterpart_name: string | null; counterpart_doc_masked: string | null; counterpart_doc_enc: string | null; is_internal_transfer: boolean; status: string;
};
export type Party = { name: string; doc: string | null; cents: number; count: number };

// palavras que separam o que a declaração trata de forma diferente (comparadas sem acento e em minúsculas)
const PHARMACY = /\b(drogaria|farmacia|droga raia|drogasil|pague menos|panvel|pacheco|drogao|ultrafarma|sao joao farm)/;
const HEALTH_PLAN = /\b(unimed|amil|sulamerica|sul america|bradesco saude|hapvida|notredame|porto seguro saude|golden cross|plano de saude|odonto|seguros? saude)/;
const PENSION_FUND = /\b(previdencia|pgbl|vgbl|brasilprev|icatu|prev privada)/;
const ALIMONY = /\bpensao( alimenticia)?\b/;
export type IrReport = Awaited<ReturnType<typeof buildIr>>;

/** 1º de janeiro (00:00 em Brasília) em ISO. */
const jan1 = (y: number) => new Date(Date.UTC(y, 0, 1, 3)).toISOString();

async function paged(db: SupabaseClient, hid: string, from: string) {
  const out: Tx[] = [];
  for (let p = 0; p < 50; p++) {
    const { data } = await db.from("transactions")
      .select("account_id, occurred_at, amount_cents, description, category_id, counterpart_name, counterpart_doc_masked, counterpart_doc_enc, is_internal_transfer, status")
      .eq("household_id", hid).is("deleted_at", null).gte("occurred_at", from).order("occurred_at").range(p * 1000, p * 1000 + 999);
    out.push(...((data ?? []) as Tx[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function buildIr(db: SupabaseClient, hid: string, year: number) {
  const [cats, accRes, holdRes, all] = await Promise.all([
    getCategories(db, hid),
    db.from("accounts").select("id, name, institution, type, number_masked, balance_cents").eq("household_id", hid),
    db.from("holdings").select("id, side, category, name, value_cents, source, details, updated_at, acquisition_cents, acquired_on").eq("household_id", hid).order("value_cents", { ascending: false }),
    paged(db, hid, jan1(year)),
  ]);
  const start = jan1(year), end = jan1(year + 1);
  const inYear = all.filter((t) => t.occurred_at < end && t.status !== "canceled");
  const top = (id: string | null) => {
    const c = cats.find((x) => x.id === id);
    return c?.parent_id ? cats.find((x) => x.id === c.parent_id) ?? c : c;
  };

  // saldos das contas em 31/12 do ano anterior e do ano (desfazendo as transações posteriores)
  const accounts = (accRes.data ?? []).filter((a) => a.type !== "credit");
  const balances = accounts.map((a) => {
    const after = (iso: string) => all.filter((t) => t.account_id === a.id && t.occurred_at >= iso).reduce((s, t) => s + Number(t.amount_cents), 0);
    const now = Number(a.balance_cents);
    return { name: a.name as string, institution: (a.institution as string | null) ?? "", number: (a.number_masked as string | null) ?? "", prev: now - after(start), end: now - after(end) };
  });
  const coverageOk = all.length > 0 && all[0].occurred_at.slice(0, 7) <= start.slice(0, 7);

  // agrupa por contraparte (documento quando houver; senão o nome)
  const group = (txs: Tx[]) => {
    const m = new Map<string, Party>();
    for (const t of txs) {
      const doc = decrypt(t.counterpart_doc_enc);
      const name = t.counterpart_name ?? t.description;
      const key = doc ?? t.counterpart_doc_masked ?? name.toLowerCase();
      const p = m.get(key) ?? { name, doc: doc ? formatDoc(doc) : t.counterpart_doc_masked, cents: 0, count: 0 };
      p.cents += Math.abs(Number(t.amount_cents)); p.count++;
      m.set(key, p);
    }
    return [...m.values()].sort((a, b) => b.cents - a.cents);
  };
  const bySlug = (slugs: string[], sign: 1 | -1) =>
    inYear.filter((t) => !t.is_internal_transfer && Math.sign(Number(t.amount_cents)) === sign && slugs.includes(top(t.category_id)?.slug ?? ""));

  const text = (t: Tx) => normalizeDesc(`${t.counterpart_name ?? ""} ${t.description}`);
  const isPF = (t: Tx) => {
    const doc = decrypt(t.counterpart_doc_enc);
    if (doc) return doc.length === 11;
    return /^\*{3}\.\d{3}\.\d{3}-\*{2}$/.test(t.counterpart_doc_masked ?? ""); // CPF mascarado
  };

  // reembolso do plano de saúde: abate da despesa médica dedutível
  const healthRefunds = inYear.filter((t) => !t.is_internal_transfer && Number(t.amount_cents) > 0 && top(t.category_id)?.kind !== "transfer" &&
    (top(t.category_id)?.slug === "reembolsos" || /reembolso/.test(text(t))) && HEALTH_PLAN.test(text(t)));
  const saudeAll = bySlug(["saude"], -1);
  const income = {
    salario: group(bySlug(["salario"], 1)),
    rendimentos: group(bySlug(["rendimentos"], 1)),
    outras: group(bySlug(["outras-entradas", "reembolsos"], 1).filter((t) => !healthRefunds.includes(t))),
  };
  const deductible = {
    saude: group(saudeAll.filter((t) => !PHARMACY.test(text(t)))),
    educacao: group(bySlug(["educacao"], -1)),
    reembolsos: group(healthRefunds),
    previdencia: group(inYear.filter((t) => Number(t.amount_cents) < 0 && !t.is_internal_transfer && PENSION_FUND.test(text(t)))),
    pensao: group(inYear.filter((t) => Number(t.amount_cents) < 0 && !t.is_internal_transfer && ALIMONY.test(text(t)))),
  };
  const naoDedutivel = { farmacia: group(saudeAll.filter((t) => PHARMACY.test(text(t)))) };

  // carnê-leão: dinheiro recebido de pessoa física (aluguel, serviços) que não é salário nem transferência sua
  const pfIn = inYear.filter((t) => !t.is_internal_transfer && Number(t.amount_cents) > 0 && top(t.category_id)?.kind !== "transfer" &&
    !["salario", "rendimentos"].includes(top(t.category_id)?.slug ?? "") && isPF(t));
  const pfByMonth = new Map<string, number>();
  for (const t of pfIn) {
    const ym = new Date(t.occurred_at).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
    pfByMonth.set(ym, (pfByMonth.get(ym) ?? 0) + Number(t.amount_cents));
  }
  const carneLeao = { parties: group(pfIn), months: [...pfByMonth.entries()].sort().map(([ym, cents]) => ({ ym, cents })) };

  const expenseByCat = new Map<string, { name: string; cents: number }>();
  for (const t of inYear) {
    if (t.is_internal_transfer || Number(t.amount_cents) >= 0) continue;
    const c = top(t.category_id);
    if (c?.kind === "transfer") continue;
    const k = c?.id ?? "none";
    const e = expenseByCat.get(k) ?? { name: c?.name ?? "Sem categoria", cents: 0 };
    e.cents += -Number(t.amount_cents);
    expenseByCat.set(k, e);
  }
  const totalIn = inYear.filter((t) => !t.is_internal_transfer && Number(t.amount_cents) > 0 && top(t.category_id)?.kind !== "transfer").reduce((s, t) => s + Number(t.amount_cents), 0);
  const holdings = ((holdRes.data ?? []) as Holding[]).map((h) => ({ ...h, value_cents: Number(h.value_cents) }));

  return {
    year, coverageOk, balances, income, deductible, naoDedutivel, carneLeao,
    expenses: [...expenseByCat.values()].sort((a, b) => b.cents - a.cents),
    totalIn, totalOut: [...expenseByCat.values()].reduce((s, e) => s + e.cents, 0),
    assets: holdings.filter((h) => h.side === "asset"), debts: holdings.filter((h) => h.side === "liability"),
    txCount: inYear.length,
  };
}
