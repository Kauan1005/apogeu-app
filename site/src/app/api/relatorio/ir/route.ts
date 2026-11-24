import { NextResponse } from "next/server";
import { createClient, createServiceClient, mfaIsRecent, requireSession } from "@/lib/supabase/server";
import { buildIr } from "@/lib/ir";
import { irPdf } from "@/lib/ir-pdf";

// PDF com CPF/CNPJ completos: exige 2FA recente, fica registrado na auditoria e nada vai para cache.
export const maxDuration = 60;

export async function GET(req: Request) {
  const s = await requireSession();
  const url = new URL(req.url);
  const thisYear = Number(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 4));
  const ano = Number(url.searchParams.get("ano"));
  const year = Number.isInteger(ano) && ano >= 2000 && ano <= thisYear ? ano : thisYear - 1;
  if (!mfaIsRecent(s)) return NextResponse.redirect(new URL(`/mfa?reauth=1&next=${encodeURIComponent(`/relatorios?ano=${year}`)}`, url));
  const db = await createClient();
  const report = await buildIr(db, s.householdId, year);
  const bytes = await irPdf(report, new Date());
  await createServiceClient().from("audit_log").insert({ household_id: s.householdId, actor: s.userId, table_name: "relatorio_ir", action: "export", diff: { year } });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="apogeu-ir-${year}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
