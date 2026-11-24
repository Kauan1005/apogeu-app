import "server-only";
import { PluggyClient, type Transaction, type Account, type Investment, type Loan } from "pluggy-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestTransactions, type IncomingTx } from "./ingest";
import { createServiceClient } from "./supabase/server";
import { decrypt } from "./crypto";

let client: PluggyClient | null = null;
/** Conta Meu Pluggy do site (administrador). Só casas com uses_app_pluggy = true usam esta. */
export function pluggy() {
  const clientId = process.env.PLUGGY_CLIENT_ID, clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Credenciais da Pluggy ausentes no .env.local");
  client ??= new PluggyClient({ clientId, clientSecret });
  return client;
}

export class PluggyNotConfigured extends Error {
  constructor() { super("Esta casa ainda não cadastrou a conta Meu Pluggy dela (Ajustes → Conta Meu Pluggy)."); }
}

const perHousehold = new Map<string, { client: PluggyClient; key: string }>();

/**
 * Cliente da Pluggy da casa: a conta do site para quem foi criado pelo administrador,
 * ou a conta Meu Pluggy própria (credenciais cifradas em pluggy_credentials) para quem entrou por código.
 */
export async function pluggyFor(householdId: string) {
  const admin = createServiceClient();
  const { data: hh } = await admin.from("households").select("uses_app_pluggy").eq("id", householdId).single();
  if (hh?.uses_app_pluggy) return pluggy();
  const { data: cred } = await admin.from("pluggy_credentials").select("client_id_enc, client_secret_enc, updated_at").eq("household_id", householdId).maybeSingle();
  if (!cred) throw new PluggyNotConfigured();
  const key = `${cred.updated_at}`;
  const cached = perHousehold.get(householdId);
  if (cached?.key === key) return cached.client;
  const clientId = decrypt(cred.client_id_enc), clientSecret = decrypt(cred.client_secret_enc);
  if (!clientId || !clientSecret) throw new PluggyNotConfigured();
  const c = new PluggyClient({ clientId, clientSecret });
  perHousehold.set(householdId, { client: c, key });
  return c;
}

const accountType = (a: Account): "checking" | "savings" | "credit" | "other" =>
  a.type === "CREDIT" ? "credit" : a.subtype === "SAVINGS_ACCOUNT" ? "savings" : a.type === "BANK" ? "checking" : "other";

const tidy = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** Converte a transação da Pluggy para o formato interno. Saída sempre negativa. */
export function fromPluggy(t: Transaction, acc: Account): IncomingTx {
  const outflow = t.type === "DEBIT";
  const cents = Math.round(Math.abs(t.amount) * 100) * (outflow ? -1 : 1);
  const party = outflow ? t.paymentData?.receiver : t.paymentData?.payer;
  const doc = party?.documentNumber?.value ?? t.merchant?.cnpj ?? null;
  const name = party?.name ?? t.merchant?.name ?? t.merchant?.businessName ?? null;
  const date = new Date(t.date);
  const hasTime = !(date.getUTCHours() === 0 && date.getUTCMinutes() === 0) && !(date.getUTCHours() === 3 && date.getUTCMinutes() === 0);
  const cc = t.creditCardMetadata;
  return {
    provider_tx_id: t.id,
    occurred_at: date.toISOString(),
    has_time: hasTime,
    amount_cents: cents,
    description_raw: t.descriptionRaw || t.description,
    description: name ? tidy(name) : tidy(t.description),
    counterpart_name: name,
    counterpart_doc: doc,
    payment_method: t.paymentData?.paymentMethod ?? (acc.type === "CREDIT" ? "CARD" : null),
    provider_category: t.category,
    purchase_date: cc?.purchaseDate ? new Date(cc.purchaseDate).toISOString().slice(0, 10) : null,
    installment_number: cc?.installmentNumber ?? null,
    total_installments: cc?.totalInstallments ?? null,
    provider_bill_id: cc?.billId ?? null,
  };
}

/**
 * Sincroniza um item (uma instituição): contas, saldos e transações.
 * `fromDate` limita a janela; no primeiro sync traz 12 meses.
 */
/**
 * Cofrinhos que o banco entrega dentro da conta (Open Finance "saldos reservados"): Mercado Pago, Nubank, Inter...
 * Um registro por cofrinho; os que sumiram do banco somem daqui; "hidden" (escolha da pessoa) é preservado.
 */
async function syncPots(db: SupabaseClient, householdId: string, accountId: string, a: Account) {
  const reserved = (a.bankData?.reservedBalances ?? []) as { name: string | null; identification: string; availableAmounts: { amount: number; remuneration?: { postFixedIndexerPercentage?: number | null } | null }[] }[];
  const rows = reserved.map((r) => ({
    household_id: householdId, account_id: accountId, provider_ref: r.identification,
    name: (r.name || "Cofrinho sem nome").slice(0, 80),
    value_cents: Math.max(0, Math.round(r.availableAmounts.reduce((s, x) => s + (x.amount ?? 0), 0) * 100)),
    rate_pct: r.availableAmounts[0]?.remuneration?.postFixedIndexerPercentage != null ? Math.round(r.availableAmounts[0].remuneration.postFixedIndexerPercentage * 10000) / 100 : null,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length) await db.from("account_pots").upsert(rows, { onConflict: "account_id,provider_ref" });
  let del = db.from("account_pots").delete().eq("account_id", accountId);
  if (rows.length) del = del.not("provider_ref", "in", `(${rows.map((r) => `"${r.provider_ref}"`).join(",")})`);
  await del;
}

/** `deadline` (ms): passado esse horário a importação para e marca `partial`; a próxima sincronização continua de onde parou. */
export async function syncItem(db: SupabaseClient, householdId: string, itemId: string, fromDate?: string, deadline: number = Date.now() + 240_000) {
  const p = await pluggyFor(householdId);
  const item = await p.fetchItem(itemId);
  const { data: conn } = await db
    .from("connections")
    .upsert(
      {
        household_id: householdId,
        provider_item_id: itemId,
        institution: item.connector?.name ?? null,
        status: item.status,
        error: item.error?.message ?? null,
        consent_expires_at: item.consentExpiresAt ? new Date(item.consentExpiresAt).toISOString() : null,
      },
      { onConflict: "provider_item_id" },
    )
    .select("id, last_synced_at")
    .single();
  if (!conn) throw new Error("Falha ao gravar a conexão");

  const since = fromDate ?? (conn.last_synced_at ? new Date(new Date(conn.last_synced_at).getTime() - 7 * 864e5) : new Date(Date.now() - 365 * 864e5)).toISOString().slice(0, 10);
  const accounts = await p.fetchAccounts(itemId);
  const totals = { inserted: 0, updated: 0, canceled: 0, review: 0, partial: false };

  const { data: known } = await db.from("accounts").select("provider_account_id, name, type, number_masked").eq("household_id", householdId);
  for (const a of accounts.results) {
    // a mesma conta autorizada duas vezes (itens diferentes) não vira duas contas nem duplica as transações
    const nm = a.marketingName || a.name, mask = a.number ? `•••• ${a.number.slice(-4)}` : null;
    if ((known ?? []).some((k) => k.provider_account_id !== a.id && k.name === nm && k.type === accountType(a) && k.number_masked === mask)) continue;
    const { data: acc } = await db
      .from("accounts")
      .upsert(
        {
          household_id: householdId,
          connection_id: conn.id,
          provider_account_id: a.id,
          name: a.marketingName || a.name,
          type: accountType(a),
          institution: item.connector?.name ?? null,
          number_masked: a.number ? `•••• ${a.number.slice(-4)}` : null,
          balance_cents: Math.round((a.type === "CREDIT" ? -Math.abs(a.balance) : a.balance) * 100),
          credit_limit_cents: a.creditData?.creditLimit != null ? Math.round(a.creditData.creditLimit * 100) : null,
          closing_day: a.creditData?.balanceCloseDate ? new Date(a.creditData.balanceCloseDate).getUTCDate() : null,
          due_day: a.creditData?.balanceDueDate ? new Date(a.creditData.balanceDueDate).getUTCDate() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider_account_id" },
      )
      .select("id")
      .single();
    if (!acc) continue;
    await syncPots(db, householdId, acc.id as string, a);
    const txs = await p.fetchAllTransactions(a.id, { dateFrom: since });
    const r = await ingestTransactions(db, householdId, acc.id, txs.map((t) => fromPluggy(t, a)), deadline);
    if (r.partial) totals.partial = true;
    totals.inserted += r.inserted; totals.updated += r.updated; totals.canceled += r.canceled; totals.review += r.review;
  }

  // patrimônio: investimentos e empréstimos/financiamentos do mesmo item (falha aqui não derruba o sync)
  try { await syncHoldings(db, householdId, conn.id, itemId); } catch (e) { console.error("holdings", String(e).slice(0, 200)); }

  // incompleta: não marca como sincronizada, para a próxima rodada reler o período inteiro (o que já entrou é pulado)
  await db.from("connections").update({ ...(totals.partial ? {} : { last_synced_at: new Date().toISOString() }), status: item.status }).eq("id", conn.id);
  return totals;
}

/** Transações apagadas pelo banco viram R$ 0,00 (cancelada), com o valor original guardado. */
export async function cancelTransactions(db: SupabaseClient, providerTxIds: string[], accountIds: string[]) {
  if (!providerTxIds.length || !accountIds.length) return 0;
  const { data } = await db.from("transactions").select("id, household_id, amount_cents, original_amount_cents, status").in("provider_tx_id", providerTxIds.slice(0, 1000)).in("account_id", accountIds);
  for (const t of data ?? []) {
    if (t.status === "canceled") continue;
    await db.from("transaction_versions").insert({ transaction_id: t.id, household_id: t.household_id, previous: t });
    await db.from("transactions").update({ amount_cents: 0, original_amount_cents: t.original_amount_cents ?? t.amount_cents, status: "canceled" }).eq("id", t.id);
  }
  return data?.length ?? 0;
}

const INV_LABEL: Record<string, string> = {
  FIXED_INCOME: "Renda fixa", MUTUAL_FUND: "Fundo", SECURITY: "Previdência", EQUITY: "Ações", COE: "COE", ETF: "ETF", OTHER: "Investimento",
};

/** Investimentos viram bens; empréstimos e financiamentos, dívidas (saldo devedor). Some do banco → some daqui. */
export async function syncHoldings(db: SupabaseClient, householdId: string, connectionId: string, itemId: string) {
  const p = await pluggyFor(householdId);
  const rows: Record<string, unknown>[] = [];
  const now = new Date().toISOString();
  const inv = await p.fetchInvestments(itemId).catch(() => ({ results: [] as Investment[] }));
  for (const i of inv.results) {
    if (i.status === "TOTAL_WITHDRAWAL") continue;
    rows.push({
      household_id: householdId, connection_id: connectionId, provider_id: `inv:${i.id}`, source: "pluggy",
      side: "asset", category: "investimento", name: (i.name || INV_LABEL[i.type] || "Investimento").slice(0, 80),
      value_cents: Math.max(0, Math.round((i.balance ?? 0) * 100)),
      acquisition_cents: i.amount != null ? Math.round(i.amount * 100) : null, acquired_on: null, // valor aplicado = custo para o IR
      details: { kind: INV_LABEL[i.type] ?? i.type, issuer: i.issuer ?? null, invested_cents: i.amount != null ? Math.round(i.amount * 100) : null },
      updated_at: now,
    });
  }
  const loans = await p.fetchLoans(itemId).catch(() => ({ results: [] as Loan[] }));
  for (const l of loans.results) {
    const owed = l.payments?.contractOutstandingBalance;
    if (owed == null || owed <= 0) continue;
    const inst = l.installments as { totalNumberOfInstallments?: number | null; paidInstallments?: number | null } | null;
    rows.push({
      household_id: householdId, connection_id: connectionId, provider_id: `loan:${l.id}`, source: "pluggy",
      side: "liability", category: l.kind === "FINANCING" ? "financiamento" : "emprestimo", name: (l.productName || "Empréstimo").slice(0, 80),
      value_cents: Math.round(owed * 100), acquisition_cents: null, acquired_on: null,
      details: {
        contract_cents: l.contractAmount != null ? Math.round(l.contractAmount * 100) : null,
        installments_total: inst?.totalNumberOfInstallments ?? null, installments_paid: inst?.paidInstallments ?? null,
        due_date: l.dueDate ? new Date(l.dueDate).toISOString().slice(0, 10) : null,
      },
      updated_at: now,
    });
  }
  if (rows.length) await db.from("holdings").upsert(rows, { onConflict: "provider_id" });
  const keep = rows.map((r) => r.provider_id as string);
  let del = db.from("holdings").delete().eq("connection_id", connectionId).eq("source", "pluggy");
  if (keep.length) del = del.not("provider_id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  await del;
  return rows.length;
}
