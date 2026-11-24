import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureBillOccurrences, getDashboard } from "./queries";
import { brl, monthRange, todayBR } from "./format";

/** Avisos no celular (Web Push). Grátis: o navegador entrega pelo serviço de push dele. */
export function pushReady() {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

/** Envia para os aparelhos dados; apaga os que o serviço de push diz que não existem mais. */
export async function sendPush(db: SupabaseClient, subs: Sub[], payload: { title: string; body: string; url: string; tag?: string }) {
  if (!pushReady() || !subs.length) return 0;
  webpush.setVapidDetails(`${process.env.PUBLIC_BASE_URL ?? "https://apogeu-financas.vercel.app"}/`, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 12 * 3600, urgency: "normal" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return sent;
}

const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * Aviso diário: contas a pagar que vencem amanhã e ainda estão em aberto. O texto não traz valores
 * (a notificação aparece na tela bloqueada). Cada aparelho recebe no máximo um aviso por dia.
 */
export async function notifyBillsDueTomorrow(db: SupabaseClient) {
  if (!pushReady()) return { skipped: "sem chaves VAPID" };
  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 864e5));
  const { data: subs } = await db.from("push_subscriptions").select("id, household_id, endpoint, p256dh, auth, last_sent_on");
  const byHh = new Map<string, (Sub & { last_sent_on: string | null })[]>();
  for (const s of subs ?? []) if (s.last_sent_on !== today) byHh.set(s.household_id, [...(byHh.get(s.household_id) ?? []), s]);
  let sent = 0;
  for (const [hid, list] of byHh) {
    await ensureBillOccurrences(db, hid, tomorrow.slice(0, 7));
    const { data: due } = await db.from("bill_occurrences").select("bills(name)").eq("household_id", hid).eq("due_date", tomorrow).is("paid_at", null);
    const names = (due ?? []).map((o) => (o.bills as unknown as { name: string } | null)?.name).filter(Boolean) as string[];
    if (!names.length) continue;
    const body = names.length === 1 ? `${names[0]} vence amanhã.` : `${names.length} contas vencem amanhã: ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}.`;
    sent += await sendPush(db, list, { title: "Contas a pagar", body, url: "/contas", tag: `contas-${tomorrow}` });
    await db.from("push_subscriptions").update({ last_sent_on: today }).in("id", list.map((s) => s.id));
  }
  return { sent };
}

/**
 * Aviso de conexão que precisa de atenção: login/autorização expirou (LOGIN_ERROR), dados desatualizados (OUTDATED),
 * erro registrado ou consentimento vencendo em 7 dias. No máximo um aviso a cada 3 dias por conexão; o texto não traz nomes.
 */
export async function notifyConnectionIssues(db: SupabaseClient) {
  if (!pushReady()) return { skipped: "sem chaves VAPID" };
  const now = Date.now();
  const soon = now + 7 * 864e5;
  const { data: conns } = await db.from("connections").select("id, household_id, status, error, consent_expires_at, alerted_at");
  const needs = (c: { status: string | null; error: string | null; consent_expires_at: string | null }) =>
    ["LOGIN_ERROR", "OUTDATED"].includes(c.status ?? "") || !!c.error || (!!c.consent_expires_at && Date.parse(c.consent_expires_at) < soon);
  // conexão que voltou ao normal: zera o controle, para o próximo problema avisar na hora
  const healed = (conns ?? []).filter((c) => c.alerted_at && !needs(c)).map((c) => c.id);
  if (healed.length) await db.from("connections").update({ alerted_at: null }).in("id", healed);
  const due = (conns ?? []).filter((c) => needs(c) && (!c.alerted_at || now - Date.parse(c.alerted_at) > 3 * 864e5));
  const byHh = new Map<string, string[]>();
  for (const c of due) byHh.set(c.household_id, [...(byHh.get(c.household_id) ?? []), c.id]);
  let sent = 0;
  for (const [hid, ids] of byHh) {
    const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("household_id", hid);
    if (!subs?.length) continue; // sem aparelho cadastrado: não marca, avisa quando houver
    const body = ids.length === 1 ? "Uma conexão com banco precisa de atenção. Abra Conexões para reconectar." : `${ids.length} conexões com bancos precisam de atenção. Abra Conexões para reconectar.`;
    sent += await sendPush(db, subs as Sub[], { title: "Conexões", body, url: "/conexoes", tag: "conexoes" });
    await db.from("connections").update({ alerted_at: new Date().toISOString() }).in("id", ids);
  }
  return { sent, healed: healed.length, pending: due.length };
}

/**
 * Resumo do mês, no dia 1 (às 07:17, junto da manutenção): quanto entrou, quanto saiu e como foi em relação ao mês anterior.
 * Entradas e saídas já descontam transferências entre suas contas, movimentos de cofrinhos e devoluções.
 * Um aviso por aparelho e por mês. `forceYm` (só para teste, via rota protegida) gera o resumo de um mês qualquer.
 */
export async function notifyMonthlySummary(db: SupabaseClient, forceYm?: string) {
  if (!pushReady()) return { skipped: "sem chaves VAPID" };
  const today = todayBR();
  if (!forceYm && today.slice(8, 10) !== "01") return { skipped: "não é dia 1" };
  const ym = forceYm ?? monthRange(today.slice(0, 7)).prev;
  const { data: subs } = await db.from("push_subscriptions").select("id, household_id, endpoint, p256dh, auth, last_summary_ym");
  const byHh = new Map<string, (Sub & { last_summary_ym: string | null })[]>();
  for (const s of subs ?? []) if (s.last_summary_ym !== ym) byHh.set(s.household_id, [...(byHh.get(s.household_id) ?? []), s]);
  let sent = 0;
  const bodies: string[] = [];
  for (const [hid, list] of byHh) {
    const d = await getDashboard(db, hid, ym);
    if (!d.hasData) continue;
    const delta = d.prevExpense ? Math.round((d.expenseCents / d.prevExpense - 1) * 100) : null;
    const body = `${d.month.label}: entrou ${brl(d.incomeCents)}, saiu ${brl(d.expenseCents)}${delta !== null && Math.abs(delta) <= 300 ? ` (saídas ${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs. mês anterior)` : ""}.`;
    if (forceYm) bodies.push(body);
    sent += await sendPush(db, list, { title: `Resumo de ${d.month.label}`, body, url: "/", tag: `resumo-${ym}` });
    await db.from("push_subscriptions").update({ last_summary_ym: ym }).in("id", list.map((s) => s.id));
  }
  return { sent, ym, ...(forceYm ? { bodies } : {}) };
}
