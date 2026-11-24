import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { takeSnapshot } from "@/lib/patrimonio";
import { makeBackup, weeklyBackupDue } from "@/lib/backup";
import { cronAuthorized } from "@/lib/cron-auth";
import { pairRefunds } from "@/lib/refunds";
import { notifyConnectionIssues, notifyMonthlySummary } from "@/lib/push";
import { markPotMoves } from "@/lib/pot-moves";

// Tarefa diária 2/2 (Vercel Cron, 07:17 em Brasília, depois da sincronização):
// 1. foto do patrimônio do mês · 2. backup semanal (guarda os 8 últimos) · 3. esvazia a lixeira (30 dias)
// 4. apaga registro de atividade com mais de 12 meses e eventos de webhook com mais de 90 dias
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = createServiceClient();
  const report: Record<string, unknown> = {};

  const { data: hhs } = await db.from("households").select("id");
  let snaps = 0;
  for (const h of hhs ?? []) { try { await takeSnapshot(db, h.id); snaps++; } catch { /* segue */ } }
  report.snapshots = snaps;

  // devoluções: reexamina o último ano (idempotente; pega pares que a sincronização não viu e desfaz os que deixaram de valer)
  const refunds: string[] = [];
  for (const h of hhs ?? []) {
    try { const r = await pairRefunds(db, h.id, 400); refunds.push(`${h.id.slice(0, 8)}: ${r.paired} novos, ${r.broken} desfeitos`); }
    catch (e) { refunds.push(`${h.id.slice(0, 8)}: ${String(e).slice(0, 80)}`); }
  }
  report.devolucoes = refunds;

  // movimentos de/para cofrinhos viram movimentação interna (corrige o que já foi importado)
  const potMoves: string[] = [];
  for (const h of hhs ?? []) { try { const n = await markPotMoves(db, h.id); if (n) potMoves.push(`${h.id.slice(0, 8)}: ${n}`); } catch { /* segue */ } }
  report.cofrinhos_movimentos = potMoves;

  // conexão com banco que precisa de atenção (autorização vencida, erro...): aviso no celular, no máximo a cada 3 dias
  try { report.alertas = await notifyConnectionIssues(db); } catch (e) { report.alertas = { error: String(e).slice(0, 100) }; }

  // resumo do mês: só no dia 1 (o parâmetro forcar_resumo=AAAA-MM existe para teste, atrás do segredo da tarefa)
  const forced = new URL(req.url).searchParams.get("forcar_resumo");
  try { report.resumo = await notifyMonthlySummary(db, forced && /^\d{4}-\d{2}$/.test(forced) ? forced : undefined); } catch (e) { report.resumo = { error: String(e).slice(0, 100) }; }

  const backups: string[] = [];
  for (const h of hhs ?? []) {
    try { if (await weeklyBackupDue(db, h.id)) { await makeBackup(db, h.id, "semanal"); backups.push(h.id.slice(0, 8)); } }
    catch (e) { backups.push(`${h.id.slice(0, 8)}: ${String(e).slice(0, 80)}`); }
  }
  report.backups = backups;

  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  const { count } = await db.from("transactions").delete({ count: "exact" }).lt("deleted_at", cutoff);
  report.purged = count ?? 0;

  // prazos declarados na política de privacidade
  const year = new Date(Date.now() - 365 * 864e5).toISOString();
  const { count: audits } = await db.from("audit_log").delete({ count: "exact" }).lt("at", year);
  const { count: hooks } = await db.from("webhook_events").delete({ count: "exact" }).lt("received_at", new Date(Date.now() - 90 * 864e5).toISOString());
  report.audit_purged = audits ?? 0;
  report.webhook_purged = hooks ?? 0;

  return NextResponse.json({ ok: true, ...report });
}
