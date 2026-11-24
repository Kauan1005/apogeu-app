"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient, requireSession } from "@/lib/supabase/server";
import { ingestTransactions, type IncomingTx } from "@/lib/ingest";

const Row = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  desc: z.string().trim().min(1).max(200),
  cents: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 100_000_000_000),
  id: z.string().max(80).optional(),
  occ: z.number().int().min(0).max(1000).default(0),
});
const Chunk = z.object({
  accountName: z.string().trim().min(2).max(60),
  kind: z.enum(["bank", "credit"]),
  invert: z.boolean(),
  rows: z.array(Row).min(1).max(150),
  /** Última parte do arquivo: grava o saldo (se informado) e o registro de atividade. */
  final: z.boolean().default(false),
  balanceCents: z.number().int().nullable().optional(),
  totalRows: z.number().int().min(1).max(5000).optional(),
});

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "conta";
/** "PIX ENVIADO JOAO SILVA" → "Pix Enviado Joao Silva" (só quando o banco manda tudo em maiúsculas). */
const pretty = (s: string) => {
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-/*])([a-zà-ÿ])/g, (_m, a, b) => a + b.toUpperCase());
};

/**
 * Importa uma parte (até 150 linhas) de um extrato lido no navegador. Passa pelo MESMO caminho das contas conectadas
 * (categorização, revisão, conciliação de contas a pagar). Idempotente: importar de novo o mesmo arquivo não duplica.
 */
export async function importStatementChunk(input: unknown) {
  const s = await requireSession();
  const p = Chunk.safeParse(input);
  if (!p.success) return { error: "Arquivo com linhas inválidas. Confira se é o extrato do banco." };
  const c = p.data;
  const db = createServiceClient();
  const providerId = `imp-${s.householdId}-${slug(c.accountName)}`;

  let { data: acc } = await db.from("accounts").select("id, type").eq("provider_account_id", providerId).maybeSingle();
  if (!acc) {
    const ins = await db.from("accounts").insert({
      household_id: s.householdId, provider_account_id: providerId, name: c.accountName,
      type: c.kind === "credit" ? "credit" : "checking", institution: "Importado",
    }).select("id, type").single();
    if (ins.error || !ins.data) return { error: "Não foi possível criar a conta importada." };
    acc = ins.data;
  }

  const txs: IncomingTx[] = c.rows.map((r) => {
    const parc = r.desc.match(/parc(?:ela)?\.?\s*(\d{1,2})\s*\/\s*(\d{1,2})/i);
    return {
      provider_tx_id: r.id ? `ofx-${r.id}` : `csv-${createHash("sha1").update(`${r.date}|${r.cents}|${r.desc}|${r.occ}`).digest("hex").slice(0, 24)}`,
      occurred_at: `${r.date}T12:00:00-03:00`,
      has_time: false,
      amount_cents: c.invert ? -r.cents : r.cents,
      description_raw: r.desc,
      description: pretty(r.desc),
      counterpart_name: null,
      counterpart_doc: null,
      payment_method: null,
      provider_category: null,
      purchase_date: null,
      installment_number: parc ? Number(parc[1]) : null,
      total_installments: parc ? Number(parc[2]) : null,
      provider_bill_id: null,
    };
  });
  const r = await ingestTransactions(db, s.householdId, acc.id as string, txs, Date.now() + 50_000);
  if (r.partial) return { error: "Demorou demais. Tente de novo: o que já entrou não duplica." };

  if (c.final) {
    if (c.balanceCents != null && acc.type !== "credit") await db.from("accounts").update({ balance_cents: c.balanceCents, updated_at: new Date().toISOString() }).eq("id", acc.id);
    await db.from("audit_log").insert({ household_id: s.householdId, actor: s.userId, table_name: "extrato_importado", action: "insert", diff: { conta: c.accountName, linhas: c.totalRows ?? c.rows.length } });
  }
  revalidatePath("/", "layout");
  return { ok: true as const, inserted: r.inserted, updated: r.updated, review: r.review, total: c.rows.length };
}
