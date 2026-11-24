import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { categorize, loadCtx, payeeKey, REVIEW_THRESHOLD, type CategorizeCtx } from "./categorize";
import { embed } from "./embeddings";
import { encrypt } from "./crypto";
import { pairRefunds } from "./refunds";

/** Transação já normalizada, venha da Pluggy ou do simulador. */
export type IncomingTx = {
  provider_tx_id: string;
  occurred_at: string;
  has_time: boolean;
  amount_cents: number; // negativo = saída
  description_raw: string;
  description: string;
  counterpart_name: string | null;
  counterpart_doc: string | null; // CPF/CNPJ cru: vira hash + máscara, nunca é gravado
  payment_method: string | null;
  provider_category: string | null;
  purchase_date: string | null;
  installment_number: number | null;
  total_installments: number | null;
  provider_bill_id: string | null;
  canceled?: boolean;
};

export const hashDoc = (doc: string) => {
  const pepper = process.env.DOC_HASH_PEPPER;
  if (!pepper || pepper.length < 16) throw new Error("DOC_HASH_PEPPER ausente: configure no ambiente");
  return createHmac("sha256", pepper).update(doc.replace(/\D/g, "")).digest("hex").slice(0, 32);
};

export const maskDoc = (doc: string) => {
  const d = doc.replace(/\D/g, "");
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : d.length === 14 ? `**.***.${d.slice(5, 8)}/${d.slice(8, 12)}-**` : "***";
};

export type IngestResult = { inserted: number; updated: number; canceled: number; review: number; ids: string[]; partial?: boolean };

/**
 * Grava transações de forma idempotente: UNIQUE (account_id, provider_tx_id).
 * Novas → categoriza e insere. Já existentes → só registra mudanças do banco (valor, cancelamento),
 * guardando a versão anterior e preservando as edições do usuário.
 */
export async function ingestTransactions(db: SupabaseClient, householdId: string, accountId: string, txs: IncomingTx[], deadline?: number): Promise<IngestResult> {
  const result: IngestResult = { inserted: 0, updated: 0, canceled: 0, review: 0, ids: [] };
  if (!txs.length) return result;

  const { data: existing } = await db
    .from("transactions")
    .select("id, provider_tx_id, amount_cents, original_amount_cents, status, description_raw")
    .eq("account_id", accountId)
    .in("provider_tx_id", txs.map((t) => t.provider_tx_id));
  const byProviderId = new Map((existing ?? []).map((e) => [e.provider_tx_id as string, e]));

  let ctx: CategorizeCtx | null = null;
  for (const t of txs) {
    if (deadline && Date.now() > deadline) { result.partial = true; break; } // acabou o tempo: o resto entra na próxima sincronização
    const prev = byProviderId.get(t.provider_tx_id);
    if (prev) {
      const nextAmount = t.canceled ? 0 : t.amount_cents;
      const changed = prev.amount_cents !== nextAmount || (t.canceled && prev.status !== "canceled") || prev.description_raw !== t.description_raw;
      if (!changed) continue;
      await db.from("transaction_versions").insert({ transaction_id: prev.id, household_id: householdId, previous: prev });
      await db
        .from("transactions")
        .update({
          amount_cents: nextAmount,
          original_amount_cents: prev.original_amount_cents ?? prev.amount_cents,
          description_raw: t.description_raw,
          ...(t.canceled ? { status: "canceled" } : {}),
        })
        .eq("id", prev.id);
      result.updated++;
      if (t.canceled) result.canceled++;
      continue;
    }

    ctx ??= await loadCtx(db, householdId);
    const docHash = t.counterpart_doc ? hashDoc(t.counterpart_doc) : null;
    const key = payeeKey(docHash, t.counterpart_name || t.description);
    const d = await categorize(ctx, {
      description: t.description,
      counterpart_name: t.counterpart_name,
      payee_key: key,
      provider_category: t.provider_category,
      amount_cents: t.amount_cents,
    });
    const status = t.canceled ? "canceled" : d.confidence >= REVIEW_THRESHOLD ? "ok" : "review";
    const { data: row, error } = await db
      .from("transactions")
      .upsert(
        {
          household_id: householdId,
          account_id: accountId,
          provider_tx_id: t.provider_tx_id,
          occurred_at: t.occurred_at,
          has_time: t.has_time,
          amount_cents: t.canceled ? 0 : t.amount_cents,
          original_amount_cents: t.canceled ? t.amount_cents : null,
          description_raw: t.description_raw,
          description: t.description,
          counterpart_name: t.counterpart_name,
          counterpart_doc_hash: docHash,
          counterpart_doc_masked: t.counterpart_doc ? maskDoc(t.counterpart_doc) : null,
          counterpart_doc_enc: t.counterpart_doc ? encrypt(t.counterpart_doc.replace(/\D/g, "")) : null,
          payee_key: key,
          payment_method: t.payment_method,
          provider_category: t.provider_category,
          category_id: d.category_id,
          category_source: d.category_source,
          confidence: d.confidence,
          status,
          is_internal_transfer: d.is_internal_transfer,
          purchase_date: t.purchase_date,
          installment_number: t.installment_number,
          total_installments: t.total_installments,
          provider_bill_id: t.provider_bill_id,
        },
        { onConflict: "account_id,provider_tx_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!row) continue; // corrida com outro webhook: já existe
    result.inserted++;
    result.ids.push(row.id);
    if (status === "review") result.review++;
    if (t.amount_cents < 0 && !d.is_internal_transfer) await reconcileBills(db, householdId, row.id, t);
  }
  // gasto + devolução do mesmo valor e destinatário se anulam
  if (result.inserted || result.updated) await pairRefunds(db, householdId).catch((e) => console.error("devolucoes", String(e).slice(0, 160)));
  return result;
}

/** Marca como paga a conta em aberto que bate com a saída (valor ±3% e data −10/+7 dias). */
export async function reconcileBills(db: SupabaseClient, householdId: string, txId: string, t: Pick<IncomingTx, "amount_cents" | "occurred_at" | "description" | "counterpart_name">) {
  const day = new Date(t.occurred_at);
  const from = new Date(day.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const to = new Date(day.getTime() + 10 * 864e5).toISOString().slice(0, 10);
  const { data: open } = await db
    .from("bill_occurrences")
    .select("id, amount_cents, due_date, bills!inner(name, match_keyword)")
    .eq("household_id", householdId)
    .is("paid_at", null)
    .gte("due_date", from)
    .lte("due_date", to);
  const abs = Math.abs(t.amount_cents);
  const text = `${t.description} ${t.counterpart_name ?? ""}`.toLowerCase();
  const hit = (open ?? []).find((o) => {
    const bill = o.bills as unknown as { name: string; match_keyword: string | null };
    const kw = (bill.match_keyword || bill.name).toLowerCase();
    return Math.abs(o.amount_cents - abs) <= o.amount_cents * 0.03 && kw.split(/\s+/).some((w) => w.length > 2 && text.includes(w));
  });
  if (!hit) return;
  await db
    .from("bill_occurrences")
    .update({ paid_at: t.occurred_at, paid_source: "auto", matched_transaction_id: txId })
    .eq("id", hit.id)
    .is("paid_at", null);
}

/** Guarda o embedding de transações categorizadas pelo usuário/regra, para a camada de semelhança. */
export async function storeEmbedding(db: SupabaseClient, householdId: string, txId: string, text: string) {
  const v = await embed(text);
  if (!v) return;
  await db.from("tx_embeddings").upsert({ transaction_id: txId, household_id: householdId, embedding: JSON.stringify(v) });
}

export { loadCtx };
