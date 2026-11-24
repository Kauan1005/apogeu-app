import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDesc } from "./format";
import { embed } from "./embeddings";
import { POT_MOVE } from "./pot-moves";

export const REVIEW_THRESHOLD = 0.7;

export type Category = { id: string; slug: string; name: string; kind: "expense" | "income" | "transfer"; color: string | null; icon: string | null };
export type Rule = { id: string; conditions: Condition[]; category_id: string; source: string };
export type Condition = { field: "description" | "counterpart_name" | "payee_key"; op: "contains" | "equals"; value: string };

export type TxInput = {
  description: string;
  counterpart_name: string | null;
  payee_key: string | null;
  provider_category: string | null;
  amount_cents: number;
};
export type Decision = {
  category_id: string | null;
  category_source: "rule" | "payee" | "provider" | "similarity" | "transfer" | "none";
  confidence: number;
  is_internal_transfer: boolean;
  rule_id?: string;
};

/** Mapeia a categoria que a Pluggy envia (em inglês) para as categorias do usuário. */
const PROVIDER_MAP: [RegExp, string, number][] = [
  [/same person|same ownership|own account/, "interna", 0.95],
  [/credit card payment|card bill/, "fatura", 0.95],
  [/salary|payroll|wage/, "salario", 0.9],
  [/interest|yield|dividend|investment income|proceeds/, "rendimentos", 0.85],
  [/refund|reimburs|cashback/, "reembolsos", 0.8],
  [/groceries|supermarket|eating out|restaurant|food|delivery|bakery|bar/, "alimentacao", 0.8],
  [/taxi|ride|uber|transport|gas station|fuel|parking|toll|bus|metro|vehicle/, "transporte", 0.8],
  [/rent|housing|mortgage|condominium|home/, "moradia", 0.8],
  [/electricity|water|utilities|internet|telecom|phone|mobile|gas bill|tv/, "contas", 0.8],
  [/pharmacy|drugstore|health|hospital|doctor|dentist|clinic|optic/, "saude", 0.8],
  [/streaming|subscription|digital service|software|music|video/, "assinaturas", 0.75],
  [/education|school|university|course|book/, "educacao", 0.8],
  [/investment|brokerage|savings|fixed income|stock/, "investimentos", 0.8],
  [/leisure|entertainment|ticket|cinema|gaming|travel|hotel|gym|sport/, "lazer", 0.75],
  [/shopping|clothing|electronics|online shop|department|marketplace|pet/, "compras", 0.7],
];

/** Palavras do extrato que já indicam a categoria com boa confiança (camada de regras padrão). */
const BUILTIN_KEYWORDS: [RegExp, string][] = [
  [/\b(uber|99 ?app|99pop|cabify|shell|ipiranga|petrobras|br mania|sem parar|veloe)\b/, "transporte"],
  [/\b(ifood|rappi|pao de acucar|carrefour|assai|atacadao|extra|padaria|mc ?donald|burger king|subway)\b/, "alimentacao"],
  [/\b(netflix|spotify|disney|hbo|max|prime video|amazon prime|youtube|apple\.com|icloud|google one|deezer|globoplay)\b/, "assinaturas"],
  [/\b(drogasil|droga raia|drogaria|pague menos|farmacia|unimed|amil|hapvida)\b/, "saude"],
  [/\b(enel|sabesp|cemig|copel|light|comgas|vivo|claro|tim|oi fibra|net servicos)\b/, "contas"],
  [/\b(smart ?fit|ingresso|cinemark|steam|playstation|airbnb|booking)\b/, "lazer"],
  [/\b(amazon|mercado ?livre|shopee|magalu|magazine luiza|americanas|shein|aliexpress|renner|c&a|zara)\b/, "compras"],
];

const matches = (c: Condition, tx: TxInput) => {
  const raw = c.field === "description" ? tx.description : c.field === "counterpart_name" ? tx.counterpart_name : tx.payee_key;
  if (!raw) return false;
  const a = normalizeDesc(raw), b = normalizeDesc(c.value);
  return c.op === "equals" ? a === b : a.includes(b);
};

export type CategorizeCtx = {
  db: SupabaseClient;
  householdId: string;
  categories: Category[];
  rules: Rule[];
  payees: Map<string, string>; // payee_key -> category_id
};

export async function loadCtx(db: SupabaseClient, householdId: string): Promise<CategorizeCtx> {
  const [cats, rules, payees] = await Promise.all([
    db.from("categories").select("id, slug, name, kind, color, icon").eq("household_id", householdId),
    db.from("rules").select("id, conditions, category_id, source").eq("household_id", householdId).eq("active", true).neq("source", "suggested"),
    db.from("payees").select("key, category_id").eq("household_id", householdId).not("category_id", "is", null),
  ]);
  return {
    db,
    householdId,
    categories: (cats.data ?? []) as Category[],
    rules: (rules.data ?? []) as Rule[],
    payees: new Map((payees.data ?? []).map((p) => [p.key as string, p.category_id as string])),
  };
}

/**
 * Camadas, da mais confiável para a menos:
 * 1. regras do usuário · 2. destinatário conhecido · 3. palavras conhecidas · 4. categoria da Pluggy · 5. semelhança com o histórico.
 */
export async function categorize(ctx: CategorizeCtx, tx: TxInput): Promise<Decision> {
  const bySlug = (slug: string) => ctx.categories.find((c) => c.slug === slug)?.id ?? null;
  const income = tx.amount_cents > 0;

  for (const r of ctx.rules) {
    if (r.conditions.length && r.conditions.every((c) => matches(c, tx))) {
      return { category_id: r.category_id, category_source: "rule", confidence: 0.99, is_internal_transfer: ctx.categories.find((c) => c.id === r.category_id)?.kind === "transfer", rule_id: r.id };
    }
  }

  if (tx.payee_key && ctx.payees.has(tx.payee_key)) {
    const pc = ctx.payees.get(tx.payee_key)!;
    return { category_id: pc, category_source: "payee", confidence: 0.97, is_internal_transfer: ctx.categories.find((c) => c.id === pc)?.kind === "transfer" };
  }

  // dinheiro indo para / voltando de um cofrinho: movimentação interna (nem gasto, nem ganho)
  if (POT_MOVE.test(normalizeDesc(`${tx.description} ${tx.counterpart_name ?? ""}`))) {
    return { category_id: bySlug("interna"), category_source: "transfer", confidence: 0.96, is_internal_transfer: true };
  }

  const provider = (tx.provider_category ?? "").toLowerCase();
  for (const [re, slug, conf] of PROVIDER_MAP.slice(0, 2)) {
    if (re.test(provider)) return { category_id: bySlug(slug), category_source: "transfer", confidence: conf, is_internal_transfer: true };
  }

  const text = normalizeDesc(`${tx.description} ${tx.counterpart_name ?? ""}`);
  if (!income) {
    for (const [re, slug] of BUILTIN_KEYWORDS) {
      if (re.test(text)) return { category_id: bySlug(slug), category_source: "rule", confidence: 0.9, is_internal_transfer: false };
    }
  }

  let best: Decision = { category_id: null, category_source: "none", confidence: 0, is_internal_transfer: false };
  for (const [re, slug, conf] of PROVIDER_MAP.slice(2)) {
    const cat = ctx.categories.find((c) => c.slug === slug);
    if (!cat || re.test(provider) === false) continue;
    if (income !== (cat.kind === "income")) continue;
    best = { category_id: cat.id, category_source: "provider", confidence: conf, is_internal_transfer: false };
    break;
  }

  const sim = await similarity(ctx, tx);
  if (sim && sim.confidence > best.confidence) best = sim;

  if (!best.category_id) {
    best = { category_id: bySlug(income ? "outras-entradas" : "outros"), category_source: "none", confidence: 0.3, is_internal_transfer: false };
  }
  return best;
}

/**
 * Semelhança com transações já categorizadas.
 * gte-small (embeddings): qualquer texto fica entre ~0,78 e ~0,86 de semelhança, então a nota bruta não diz nada.
 * O que separa acerto de palpite é a FOLGA sobre a melhor categoria concorrente (ou sobre o “ruído” de 0,80):
 *   folga ≥ 0,03 → confiável (≥ 70%);  folga pequena → vai para Revisar.
 * Sem embeddings disponíveis, usa trigramas do Postgres (aí a nota já é significativa).
 */
const EMB_NOISE = 0.8;
async function similarity(ctx: CategorizeCtx, tx: TxInput): Promise<Decision | null> {
  type Hit = { category_id: string; score: number };
  const vector = await embed(`${tx.description} ${tx.counterpart_name ?? ""}`);
  if (vector) {
    const { data } = await ctx.db.rpc("similar_by_embedding", { q: JSON.stringify(vector), hid: ctx.householdId, lim: 10 });
    const hits = (data ?? []) as Hit[];
    if (hits.length) {
      const top = hits[0];
      const rival = hits.find((h) => h.category_id !== top.category_id)?.score ?? EMB_NOISE;
      const margin = top.score - Math.max(rival, EMB_NOISE);
      const conf = Math.min(0.95, 0.55 + margin * 5);
      if (margin > 0) return { category_id: top.category_id, category_source: "similarity", confidence: Number(conf.toFixed(2)), is_internal_transfer: false };
      return null;
    }
  }
  const { data } = await ctx.db.rpc("similar_by_text", { q: tx.description, hid: ctx.householdId, lim: 5 });
  const hits = (data ?? []) as Hit[];
  if (!hits.length) return null;
  const top = hits[0];
  const agree = hits.filter((h) => h.category_id === top.category_id).length;
  const conf = Math.min(0.95, top.score * 0.9 + (agree >= 2 ? 0.08 : 0));
  if (conf < 0.4) return null;
  return { category_id: top.category_id, category_source: "similarity", confidence: Number(conf.toFixed(2)), is_internal_transfer: false };
}

/** Chave do destinatário: documento em hash quando existe, senão as 3 primeiras palavras da descrição. */
export function payeeKey(docHash: string | null, description: string) {
  if (docHash) return `doc:${docHash}`;
  const words = normalizeDesc(description)
    .split(" ")
    .filter((w) => w.length > 1 && !["pix", "enviado", "recebido", "pag", "pagamento", "compra", "ted", "doc", "transf"].includes(w));
  return words.length ? `d:${words.slice(0, 3).join(" ")}` : null;
}
