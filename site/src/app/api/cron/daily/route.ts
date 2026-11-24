import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncItem } from "@/lib/pluggy";
import { cronAuthorized } from "@/lib/cron-auth";
import { notifyBillsDueTomorrow } from "@/lib/push";

// Tarefa diária 1/2 (Vercel Cron, 06:17 em Brasília): mantém o Supabase grátis ativo e sincroniza
// as conexões (reserva caso um webhook falhe). A manutenção (patrimônio, backup, lixeira) roda à parte.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = createServiceClient();
  const report: Record<string, unknown> = {};

  const { data: ping } = await db.rpc("ping");
  report.ping = ping;

  const { data: conns } = await db.from("connections").select("household_id, provider_item_id").neq("status", "error");
  const synced: { item: string; inserted?: number; partial?: boolean; error?: string }[] = [];
  const deadline = Date.now() + 260_000; // a função tem 300 s: o que não couber continua amanhã
  for (const c of conns ?? []) {
    try {
      const r = await syncItem(db, c.household_id, c.provider_item_id, undefined, deadline);
      synced.push({ item: c.provider_item_id.slice(0, 8), inserted: r.inserted, ...(r.partial ? { partial: true } : {}) });
    } catch (e) {
      synced.push({ item: c.provider_item_id.slice(0, 8), error: String(e).slice(0, 120) });
    }
  }
  report.synced = synced;
  try { report.avisos = await notifyBillsDueTomorrow(db); } catch (e) { report.avisos = { error: String(e).slice(0, 120) }; }
  return NextResponse.json({ ok: true, ...report });
}
