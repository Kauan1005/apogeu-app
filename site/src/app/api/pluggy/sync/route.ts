import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient, requireSession } from "@/lib/supabase/server";
import { PluggyNotConfigured, pluggyFor, syncItem } from "@/lib/pluggy";

// a primeira importação grava centenas de transações uma a uma (classificação, regras, contas a pagar)
export const maxDuration = 300;

const Body = z.object({ itemId: z.string().uuid().optional() });

// Sincroniza uma conexão nova (itemId, vindo do widget) ou todas as conexões do usuário.
export async function POST(req: Request) {
  const s = await requireSession();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const db = createServiceClient();

  let itemIds: string[];
  if (parsed.data.itemId) {
    // nunca “puxa” para esta casa um item que já é de outra
    const { data: other } = await db.from("connections").select("household_id").eq("provider_item_id", parsed.data.itemId).maybeSingle();
    if (other && other.household_id !== s.householdId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data: hh } = await db.from("households").select("uses_app_pluggy").eq("id", s.householdId).single();
    let item;
    try { item = await (await pluggyFor(s.householdId)).fetchItem(parsed.data.itemId); }
    catch (e) {
      if (e instanceof PluggyNotConfigured) return NextResponse.json({ error: "pluggy_not_configured", message: "Cole antes as suas chaves da Pluggy." }, { status: 409 });
      return NextResponse.json({ error: "not_found", message: "Item não encontrado na sua conta Pluggy. Confira o ID." }, { status: 404 });
    }
    // conta do site: o item precisa ter nascido nesta casa (clientUserId). Conta própria (Meu Pluggy): se as
    // credenciais da casa conseguem ler o item, ele é dela (itens do Meu Pluggy não têm clientUserId).
    if (hh?.uses_app_pluggy !== false && item.clientUserId !== s.householdId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    itemIds = [item.id];
  } else {
    const { data } = await db.from("connections").select("provider_item_id, last_synced_at").eq("household_id", s.householdId);
    // “sincronizar agora” no máximo a cada 2 minutos (poupa a cota da Pluggy)
    if ((data ?? []).some((c) => c.last_synced_at && Date.now() - Date.parse(c.last_synced_at) < 120_000)) {
      return NextResponse.json({ error: "too_soon", message: "Sincronizado há menos de 2 minutos." }, { status: 429 });
    }
    itemIds = (data ?? []).map((c) => c.provider_item_id);
  }

  const totals = { inserted: 0, updated: 0, canceled: 0, review: 0, partial: false };
  const deadline = Date.now() + 240_000; // um tempo só para todas as conexões
  for (const id of itemIds) {
    const r = await syncItem(db, s.householdId, id, undefined, deadline);
    if (r.partial) totals.partial = true;
    // quem conectou pelo widget fica registrado (decide quem pode renovar e desconectar)
    if (parsed.data.itemId) await db.from("connections").update({ created_by: s.userId }).eq("provider_item_id", id).is("created_by", null);
    totals.inserted += r.inserted; totals.updated += r.updated; totals.canceled += r.canceled; totals.review += r.review;
  }
  return NextResponse.json({ ok: true, ...totals });
}
