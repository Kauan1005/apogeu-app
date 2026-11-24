import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dinheiro que entra ou sai de um cofrinho (Mercado Pago: "Dinheiro reservado X" / "Dinheiro retirado X"; outros bancos:
 * resgate/aplicação em cofrinho ou caixinha) é só movimentação entre o que é seu: não conta como gasto nem como ganho.
 * O texto vem de normalizeDesc (minúsculo, sem acento).
 */
export const POT_MOVE = /\b(dinheiro (reservado|retirado)|(resgate|aplicacao|deposito|guardado|guardar) (n[oa] |d[oa] |de |em |para )?(cofrinho|caixinha|reserva|cofre)s?)\b/;

// mesmas ideias em filtro do banco (ilike), para corrigir o que já foi importado
const SQL_PATTERNS = ["Dinheiro reservado%", "Dinheiro retirado%", "%resgate%cofrinho%", "%resgate%caixinha%", "%aplicacao%cofrinho%", "%aplicação%cofrinho%", "%aplicacao%caixinha%", "%aplicação%caixinha%"];

/**
 * Corrige o que já está no banco:
 * 1. lançamentos de/para cofrinho viram movimentação interna. Não mexe no que a pessoa categorizou à mão, nem no que um destinatário
 *    aprendido ou uma regra DELA decidiu (as palavras-chave embutidas também gravam origem "regra", e essas são substituídas);
 * 2. lançamento que a pessoa pôs em "Transferência interna" mas ficou sem a marca de movimentação interna passa a tê-la.
 */
export async function markPotMoves(db: SupabaseClient, hid: string) {
  const { data: cat } = await db.from("categories").select("id").eq("household_id", hid).eq("slug", "interna").maybeSingle();
  if (!cat) return 0;

  // termos das regras da própria pessoa: se a descrição contém algum, a regra manda
  const { data: rules } = await db.from("rules").select("conditions").eq("household_id", hid).eq("active", true);
  const mine = (rules ?? []).flatMap((r) => ((r.conditions as { value?: string }[] | null) ?? []).map((c) => String(c.value ?? "").toLowerCase()).filter((v) => v.length >= 3));

  const cand: { id: string; description_raw: string; category_source: string }[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data } = await db.from("transactions").select("id, description_raw, category_source")
      .eq("household_id", hid).eq("is_internal_transfer", false).is("deleted_at", null)
      .not("category_source", "in", "(user,payee)")
      .or(SQL_PATTERNS.map((p) => `description_raw.ilike.${p}`).join(","))
      .range(from, from + 999);
    cand.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const ids = cand.filter((c) => !(c.category_source === "rule" && mine.some((t) => c.description_raw.toLowerCase().includes(t)))).map((c) => c.id);
  let n = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("transactions")
      .update({ is_internal_transfer: true, category_id: cat.id, category_source: "transfer", confidence: 0.96, status: "ok" })
      .in("id", ids.slice(i, i + 200)).select("id");
    n += data?.length ?? 0;
  }

  // regras da própria pessoa que mandam para "Transferência interna" (condição simples "descrição contém"): valem também para o que já foi importado
  const { data: toInternal } = await db.from("rules").select("conditions").eq("household_id", hid).eq("active", true).eq("category_id", cat.id);
  for (const r of toInternal ?? []) {
    const cs = (r.conditions as { field?: string; op?: string; value?: string }[] | null) ?? [];
    if (cs.length !== 1 || cs[0].field !== "description" || cs[0].op !== "contains" || String(cs[0].value ?? "").length < 3) continue;
    const v = String(cs[0].value).replace(/[%_,()*]/g, " ").trim();
    const { data } = await db.from("transactions")
      .update({ is_internal_transfer: true, category_id: cat.id, category_source: "rule", confidence: 0.99, status: "ok" })
      .eq("household_id", hid).eq("is_internal_transfer", false).is("deleted_at", null).not("category_source", "in", "(user,payee)")
      .ilike("description_raw", `%${v}%`).select("id");
    n += data?.length ?? 0;
  }

  // categoria "Transferência interna" escolhida à mão, sem a marca: alinha (a escolha da pessoa vale)
  const { data: aligned } = await db.from("transactions").update({ is_internal_transfer: true })
    .eq("household_id", hid).eq("category_id", cat.id).eq("is_internal_transfer", false).is("deleted_at", null).select("id");
  return n + (aligned?.length ?? 0);
}
