import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSession, mfaIsRecent } from "@/lib/supabase/server";
import { PluggyNotConfigured, pluggyFor } from "@/lib/pluggy";
import { canManageConnection } from "@/lib/people";

// Token de curta duração para o widget Pluggy Connect. O client_secret nunca sai do servidor.
export async function POST(req: Request) {
  const s = await requireSession();
  if (!mfaIsRecent(s)) return NextResponse.json({ error: "reauth" }, { status: 403 });
  const parsed = z.object({ itemId: z.string().uuid().optional() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { itemId } = parsed.data;
  if (itemId) {
    // renovar só conexões que são suas
    const db = await createClient();
    const { data: own } = await db.from("connections").select("id, created_by").eq("provider_item_id", itemId).maybeSingle();
    if (!own || !canManageConnection(own, s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let p;
  try { p = await pluggyFor(s.householdId); } catch (e) {
    if (e instanceof PluggyNotConfigured) return NextResponse.json({ error: "pluggy_not_configured" }, { status: 409 });
    throw e;
  }
  const { accessToken } = await p.createConnectToken(itemId, {
    clientUserId: s.householdId,
    // o Meu Pluggy usa o mesmo login para cada banco adicionado: com a trava ligada, a segunda autorização é recusada como duplicada
    avoidDuplicates: !!itemId,
    // o webhook é cadastrado uma vez pela API, com o segredo em cabeçalho (scripts/setup-webhook.mjs)
  });
  return NextResponse.json({ accessToken });
}
