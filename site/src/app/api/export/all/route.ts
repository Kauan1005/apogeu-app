import { NextResponse } from "next/server";
import { createClient, mfaIsRecent, requireSession } from "@/lib/supabase/server";
import { dumpHousehold, stripKeys } from "@/lib/backup";

// LGPD: exporta TODOS os seus dados em um arquivo JSON. Exige 2FA dos últimos 15 minutos.
export async function GET(req: Request) {
  const s = await requireSession();
  if (!mfaIsRecent(s)) return NextResponse.redirect(new URL(`/mfa?reauth=1&next=${encodeURIComponent("/ajustes#privacidade")}`, req.url));
  const db = await createClient();
  const data = await dumpHousehold(db, s.householdId);
  // hash e cifra do documento das contrapartes não são legíveis; sai a versão mascarada. Embeddings são internos.
  const out = { exported_at: new Date().toISOString(), household_id: s.householdId, user_id: s.userId, ...(stripKeys(data, ["counterpart_doc_hash", "counterpart_doc_enc", "embedding"]) as object) };
  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="apogeu-meus-dados-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
