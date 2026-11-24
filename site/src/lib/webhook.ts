import "server-only";
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEventPayload } from "pluggy-sdk";
import { createServiceClient } from "./supabase/server";
import { cancelTransactions, pluggy, pluggyFor, PluggyNotConfigured, syncItem } from "./pluggy";
import type { SupabaseClient } from "@supabase/supabase-js";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Segredo do webhook de cada casa com conta Meu Pluggy própria (derivado; o segredo-mestre nunca sai do servidor). */
export function householdWebhookSecret(hid: string) {
  const master = process.env.PLUGGY_WEBHOOK_SECRET ?? "";
  if (!master) throw new Error("PLUGGY_WEBHOOK_SECRET ausente");
  return createHmac("sha256", master).update(`webhook:${hid}`).digest("hex");
}

const ERROR_STATUS = new Set(["LOGIN_ERROR", "OUTDATED", "WAITING_USER_INPUT", "WAITING_USER_ACTION"]);

/**
 * Webhook da Pluggy. scope = null: conta Meu Pluggy do site (só casas do administrador);
 * scope = hid: conta própria daquela casa (só itens daquela casa).
 * 1. confere o segredo · 2. grava o evento (event_id único = idempotência) · 3. busca os dados na API (o corpo é só aviso)
 */
export async function handlePluggyWebhook(req: Request, scopeHid: string | null) {
  const expected = scopeHid ? householdWebhookSecret(scopeHid) : process.env.PLUGGY_WEBHOOK_SECRET ?? "";
  const got = req.headers.get("x-webhook-secret") ?? "";
  if (!expected || !same(got, expected)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as WebhookEventPayload | null;
  if (!body?.eventId || !body.event) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const db = createServiceClient();
  const { error: insErr } = await db.from("webhook_events").insert({ event_id: body.eventId, event: body.event, payload: body });
  if (insErr) {
    if (insErr.code !== "23505") return NextResponse.json({ error: "store_failed" }, { status: 500 }); // a Pluggy tenta de novo
    const { data: prev } = await db.from("webhook_events").select("processed_at, error").eq("event_id", body.eventId).single();
    if (prev?.processed_at && !prev.error) return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    if ("itemId" in body && body.itemId) {
      const { data: conn } = await db.from("connections").select("id, household_id, households(uses_app_pluggy)").eq("provider_item_id", body.itemId).maybeSingle();
      const appHousehold = (conn?.households as unknown as { uses_app_pluggy: boolean } | null)?.uses_app_pluggy === true;
      // cada endereço só mexe nos itens que são dele
      const allowed = !!conn && (scopeHid ? conn.household_id === scopeHid : appHousehold);
      if (!conn && ["item/created", "item/updated"].includes(body.event)) {
        await adoptNewItem(db, body.itemId, scopeHid);
      }
      if (conn && allowed) {
        if (body.event === "transactions/deleted") {
          const { data: accs } = await db.from("accounts").select("id").eq("connection_id", conn.id);
          await cancelTransactions(db, body.transactionIds, (accs ?? []).map((a) => a.id));
        } else if (body.event === "item/error") {
          const item = await (await pluggyFor(conn.household_id)).fetchItem(body.itemId); // o estado vem da API, não do corpo
          if (ERROR_STATUS.has(item.status)) {
            await db.from("connections").update({ status: "error", error: item.error?.message?.slice(0, 200) ?? "Erro na conexão" }).eq("id", conn.id);
          }
        } else if (["item/updated", "transactions/created", "transactions/updated", "item/created"].includes(body.event)) {
          // avisos em rajada não viram sincronizações em rajada (no máximo uma por minuto por banco)
          const { data: last } = await db.from("connections").select("last_synced_at").eq("id", conn.id).single();
          if (!last?.last_synced_at || Date.now() - Date.parse(last.last_synced_at) > 60_000) await syncItem(db, conn.household_id, body.itemId);
        }
      }
    }
    await db.from("webhook_events").update({ processed_at: new Date().toISOString(), error: null }).eq("event_id", body.eventId);
  } catch (e) {
    // casa que removeu as chaves da Pluggy: o aviso não tem mais o que fazer; não pede reenvio sem fim
    if (e instanceof PluggyNotConfigured) {
      await db.from("webhook_events").update({ processed_at: new Date().toISOString(), error: "pluggy_not_configured" }).eq("event_id", body.eventId);
      return NextResponse.json({ ok: true, ignored: "pluggy_not_configured" });
    }
    await db.from("webhook_events").update({ error: String(e).slice(0, 500) }).eq("event_id", body.eventId);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 }); // a Pluggy reenvia; reprocessamos
  }
  return NextResponse.json({ ok: true });
}

/**
 * Banco novo que o Fluxo ainda não conhece (ex.: os demais bancos do Meu Pluggy, que viram itens separados).
 * Só entra quando o dono é certo: no endereço de uma casa (credenciais próprias, então o item é dela) ou,
 * na conta do site, quando o item nasceu pela janela de uma casa da conta do site (clientUserId).
 */
async function adoptNewItem(db: SupabaseClient, itemId: string, scopeHid: string | null) {
  let hid = scopeHid;
  if (!hid) {
    const item = await pluggy().fetchItem(itemId).catch(() => null);
    if (!item) return;
    const owner = item.clientUserId;
    if (owner && /^[0-9a-f-]{36}$/.test(owner)) {
      const { data: hh } = await db.from("households").select("id, uses_app_pluggy").eq("id", owner).maybeSingle();
      if (!hh?.uses_app_pluggy) return;
      hid = hh.id as string;
    } else {
      // espelhos do Meu Pluggy podem vir sem clientUserId: só entram na casa do administrador, configurada
      // explicitamente (PLUGGY_FALLBACK_HOUSEHOLD_ID). Nunca "adivinha" a casa pela contagem.
      const fallback = process.env.PLUGGY_FALLBACK_HOUSEHOLD_ID ?? "";
      if (!/^[0-9a-f-]{36}$/.test(fallback)) return;
      const { data: hh } = await db.from("households").select("id, uses_app_pluggy").eq("id", fallback).maybeSingle();
      if (!hh?.uses_app_pluggy) return;
      hid = hh.id as string;
    }
  } else {
    const { data: hh } = await db.from("households").select("uses_app_pluggy").eq("id", hid).maybeSingle();
    if (!hh || hh.uses_app_pluggy) return; // casa da conta do site usa o endereço principal
    const ok = await (await pluggyFor(hid)).fetchItem(itemId).then(() => true, () => false);
    if (!ok) return;
  }
  await syncItem(db, hid, itemId);
  // quem autorizou o Meu Pluggy nesta casa vira o "dono" do banco novo (sair da casa desconecta junto)
  const { data: auth } = await db.from("connections").select("created_by").eq("household_id", hid).ilike("institution", "%meupluggy%")
    .not("created_by", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (auth?.created_by) await db.from("connections").update({ created_by: auth.created_by }).eq("provider_item_id", itemId).eq("household_id", hid).is("created_by", null);
}
