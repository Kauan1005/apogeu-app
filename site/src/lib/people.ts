import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pluggyFor } from "./pluggy";

/** E-mail de cada pessoa da casa (vem do Auth; só o cliente de serviço lê). */
export async function householdPeople(admin: SupabaseClient, hid: string) {
  const { data: rows } = await admin.from("household_members").select("user_id, role, created_at").eq("household_id", hid).order("created_at");
  return Promise.all((rows ?? []).map(async (m) => {
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    return {
      id: m.user_id as string, role: m.role as "owner" | "member", since: m.created_at as string,
      email: data.user?.email ?? "pessoa removida",
      active: !!data.user?.factors?.some((f) => f.status === "verified"),
    };
  }));
}

/** Quem pode mexer numa conexão: quem conectou, ou o dono da casa (inclusive conexões sem autor). */
export const canManageConnection = (c: { created_by: string | null }, s: { userId: string; role: string }) =>
  c.created_by === s.userId || s.role === "owner";

/**
 * Revoga na Pluggy os bancos que uma pessoa conectou (ao sair ou ser removida da casa).
 * keepHistory=false apaga também as contas e transações importadas desses bancos.
 */
export async function revokeConnectionsOf(admin: SupabaseClient, hid: string, userId: string, keepHistory: boolean) {
  const { data: conns } = await admin.from("connections").select("id, provider_item_id").eq("household_id", hid).eq("created_by", userId);
  for (const c of conns ?? []) {
    try { await (await pluggyFor(hid)).deleteItem(c.provider_item_id); } catch { /* já revogada */ }
    if (keepHistory) await admin.from("accounts").update({ connection_id: null }).eq("connection_id", c.id);
    else await admin.from("accounts").delete().eq("connection_id", c.id); // transações vão junto (cascade)
    await admin.from("holdings").delete().eq("connection_id", c.id).eq("source", "pluggy");
    await admin.from("connections").delete().eq("id", c.id);
  }
  return conns?.length ?? 0;
}
