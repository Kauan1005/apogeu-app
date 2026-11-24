import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDesc } from "./format";

/**
 * Devoluções: gastei R$ 10 e o mesmo destinatário devolveu R$ 10 → os dois se anulam ("como se não tivesse saído nada").
 * O par fica marcado como is_internal_transfer (fora de gastos e entradas, também no IR) e com refund_pair_id.
 * Só pareia valor exatamente igual, mesmo destinatário (documento ou nome) e devolução depois do gasto: em até 60 dias quando o
 * banco escreve "devolução/estorno/reembolso"; sem essa palavra (Pix comum de volta), só em até 10 dias, para não confundir com pagamentos
 * independentes entre pessoas.
 * Devolução parcial não é pareada (continua como entrada).
 */
const MAX_GAP_DAYS = 60;
const PLAIN_GAP_DAYS = 10;
const REFUND_WORD = /devol|estorn|reembols/i;
const WORDS = new Set(["pix", "enviado", "recebido", "pag", "pagamento", "compra", "ted", "doc", "transf", "devolucao", "devolvido", "devolvida", "devolvidos", "estorno", "estornado", "reembolso", "cancelamento", "credito", "debito"]);

type Row = {
  id: string; occurred_at: string; amount_cents: number; description: string; description_raw: string | null;
  counterpart_name: string | null; counterpart_doc_hash: string | null; is_internal_transfer: boolean; refund_pair_id: string | null;
};
const COLS = "id, occurred_at, amount_cents, description, description_raw, counterpart_name, counterpart_doc_hash, is_internal_transfer, refund_pair_id";

/** O gasto `o` e a devolução `r` formam um par válido? (devolução depois do gasto, valor igual e prazo coerente) */
function validPair(o: Row, r: Row) {
  const gap = Date.parse(r.occurred_at) - Date.parse(o.occurred_at);
  const max = REFUND_WORD.test(`${r.description_raw ?? ""} ${r.description}`) ? MAX_GAP_DAYS : PLAIN_GAP_DAYS;
  return o.amount_cents < 0 && r.amount_cents === -o.amount_cents && gap >= 0 && gap <= max * 864e5;
}

/** Mesmo destinatário: documento quando existe; senão as 3 primeiras palavras do nome, sem "pix", "devolução", "estorno"... */
export function refundKey(t: Pick<Row, "counterpart_doc_hash" | "counterpart_name" | "description">) {
  if (t.counterpart_doc_hash) return `doc:${t.counterpart_doc_hash}`;
  const words = normalizeDesc(t.counterpart_name || t.description).split(" ").filter((w) => w.length > 1 && !WORDS.has(w));
  return words.length ? `d:${words.slice(0, 3).join(" ")}` : null;
}

async function load(db: SupabaseClient, hid: string, sinceIso: string) {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("transactions").select(COLS).eq("household_id", hid).is("deleted_at", null).neq("status", "canceled")
      .gte("occurred_at", sinceIso).order("occurred_at", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]).map((r) => ({ ...r, amount_cents: Number(r.amount_cents) })));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

/** `days`: quantos dias para trás reexaminar (as devoluções recentes); o gasto original pode ter até 60 dias antes. */
export async function pairRefunds(db: SupabaseClient, hid: string, days = 75) {
  const rows = await load(db, hid, new Date(Date.now() - (days + MAX_GAP_DAYS) * 864e5).toISOString());
  const byId = new Map(rows.map((r) => [r.id, r]));

  // 1) pares que deixaram de valer (banco corrigiu o valor, cancelou ou a transação foi para a lixeira)
  const missing = [...new Set(rows.filter((r) => r.refund_pair_id && !byId.has(r.refund_pair_id)).map((r) => r.refund_pair_id as string))];
  if (missing.length) {
    const { data } = await db.from("transactions").select(COLS).in("id", missing).is("deleted_at", null).neq("status", "canceled");
    for (const r of (data ?? []) as Row[]) byId.set(r.id, { ...r, amount_cents: Number(r.amount_cents) });
  }
  let broken = 0;
  for (const r of rows) {
    if (!r.refund_pair_id) continue;
    const o = byId.get(r.refund_pair_id);
    if (o && o.refund_pair_id === r.id && (r.amount_cents > 0 ? validPair(o, r) : validPair(r, o))) continue;
    await db.from("transactions").update({ is_internal_transfer: false, refund_pair_id: null }).eq("id", r.id);
    r.is_internal_transfer = false; r.refund_pair_id = null; broken++;
  }

  // 2) novos pares
  const free = rows.filter((r) => !r.is_internal_transfer && !r.refund_pair_id && r.amount_cents !== 0);
  const outs = new Map<string, Row[]>();
  for (const r of free) {
    if (r.amount_cents >= 0) continue;
    const k = refundKey(r); if (!k) continue;
    const key = `${k}|${-r.amount_cents}`;
    outs.set(key, [...(outs.get(key) ?? []), r]);
  }
  const used = new Set<string>();
  const pairs: [Row, Row][] = [];
  for (const r of free) {
    if (r.amount_cents <= 0) continue;
    const k = refundKey(r); if (!k) continue;
    const when = Date.parse(r.occurred_at);
    const cands = (outs.get(`${k}|${r.amount_cents}`) ?? []).filter((o) => !used.has(o.id) && validPair(o, r));
    const o = cands[cands.length - 1]; // o gasto mais recente antes da devolução
    if (!o) continue;
    used.add(o.id);
    pairs.push([o, r]);
  }
  for (const [o, r] of pairs) {
    await db.from("transactions").update({ is_internal_transfer: true, refund_pair_id: r.id }).eq("id", o.id);
    await db.from("transactions").update({ is_internal_transfer: true, refund_pair_id: o.id }).eq("id", r.id);
  }
  return { paired: pairs.length, broken };
}
