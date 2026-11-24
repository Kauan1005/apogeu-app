import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createServiceClient, requireSession } from "@/lib/supabase/server";
import { ingestTransactions } from "@/lib/ingest";

// Simulador de Pix para teste de ponta a ponta (o sandbox da Pluggy não tem Pix).
// Passa pelo MESMO caminho de importação: categorização, revisão e conciliação de contas.
const Body = z.object({
  name: z.string().min(2).max(80),
  amount: z.number().positive().max(1_000_000),
  direction: z.enum(["out", "in"]).default("out"),
  cpf: z.string().regex(/^\d{11}$/).optional(),
  // compra no cartão de crédito simulado (com parcelas) em vez de Pix
  card: z.boolean().optional(),
  installments: z.number().int().min(1).max(24).optional(),
  daysAgo: z.number().int().min(0).max(400).optional(),
});

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.ENABLE_DEV_SIMULATOR !== "true") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  const s = await requireSession();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  const { name, amount, direction, cpf, card, installments = 1, daysAgo = 0 } = parsed.data;

  const db = createServiceClient();
  const { data: acc } = await db
    .from("accounts")
    .upsert(
      card
        ? { household_id: s.householdId, provider_account_id: `simcc-${s.householdId}`, name: "Cartão simulado", type: "credit", institution: "Simulador", credit_limit_cents: 500000, closing_day: 5, due_day: 12 }
        : { household_id: s.householdId, provider_account_id: `sim-${s.householdId}`, name: "Conta simulada", type: "checking", institution: "Simulador" },
      { onConflict: "provider_account_id" },
    )
    .select("id")
    .single();
  if (!acc) return NextResponse.json({ error: "account" }, { status: 500 });

  const cents = Math.round((amount * 100) / installments) * (direction === "out" ? -1 : 1);
  const raw = card ? `${name.toUpperCase()}${installments > 1 ? ` PARC 01/${String(installments).padStart(2, "0")}` : ""}` : `PIX ${direction === "out" ? "ENVIADO" : "RECEBIDO"} ${name.toUpperCase()}`;
  const when = new Date(Date.now() - daysAgo * 864e5).toISOString();
  const r = await ingestTransactions(db, s.householdId, acc.id, [
    {
      provider_tx_id: `sim-${randomUUID()}`,
      occurred_at: when,
      has_time: true,
      amount_cents: cents,
      description_raw: raw,
      description: name,
      counterpart_name: name,
      counterpart_doc: cpf ?? null,
      payment_method: card ? "CARD" : "PIX",
      provider_category: null,
      purchase_date: null,
      installment_number: card && installments > 1 ? 1 : null,
      total_installments: card && installments > 1 ? installments : null,
      provider_bill_id: null,
    },
  ]);
  const { data: bal } = await db.from("accounts").select("balance_cents").eq("id", acc.id).single();
  await db.from("accounts").update({ balance_cents: (bal?.balance_cents ?? 0) + cents }).eq("id", acc.id);
  const { data: tx } = await db.from("transactions").select("id, category_id, category_source, confidence, status, categories(name)").eq("id", r.ids[0]).single();
  return NextResponse.json({ ok: true, transaction: tx });
}
