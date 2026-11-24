import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Registro de auditoria em frases simples: quem fez o quê e quando (modo casal).
const WHAT: Record<string, string> = {
  transactions: "a transação", rules: "a regra", bills: "a conta fixa", bill_occurrences: "o pagamento de conta fixa", connections: "a conexão com banco",
  budgets: "o orçamento", goals: "a meta", holdings: "o bem ou dívida", household_invites: "o convite",
};
const VERB: Record<string, string> = { insert: "criou", update: "alterou", delete: "apagou" };
const SPECIAL: Record<string, string> = { relatorio_ir: "baixou o PDF do IR", backup_download: "baixou um backup", mfa_reset: "redefiniu um 2FA", mfa_ligado: "ligou a verificação em duas etapas", mfa_desligado: "desligou a verificação em duas etapas", passkey_add: "cadastrou a biometria", passkey_del: "removeu a biometria", extrato_importado: "importou um extrato", biometria_sem_codigo_ligada: "passou a entrar só com a biometria, sem o código", biometria_sem_codigo_desligada: "voltou a pedir o código depois da biometria" };

type Row = { at: string; actor: string | null; table_name: string; action: string; diff: Record<string, unknown> | null };

function label(r: Row) {
  if (SPECIAL[r.table_name]) return SPECIAL[r.table_name];
  const d = (r.diff ?? {}) as { new?: Record<string, unknown>; old?: Record<string, unknown> } & Record<string, unknown>;
  const src = (d.new ?? d.old ?? d) as Record<string, unknown>;
  const name = String(src.description ?? src.name ?? src.institution ?? src.email ?? "").slice(0, 60);
  let verb = VERB[r.action] ?? r.action;
  // edição de transação: diz o que mudou de mais comum
  if (r.table_name === "transactions" && r.action === "update" && d.old && d.new) {
    if (d.old.category_id !== d.new.category_id) return `mudou a categoria da transação${name ? ` “${name}”` : ""}`;
    else if (!d.old.deleted_at && d.new.deleted_at) verb = "mandou para a lixeira";
    else if (d.old.deleted_at && !d.new.deleted_at) verb = "restaurou";
  }
  return `${verb} ${WHAT[r.table_name] ?? r.table_name}${name ? ` “${name}”` : ""}`;
}

export async function recentActivity(db: SupabaseClient, hid: string, people: { id: string; email: string }[], userId: string, limit = 30) {
  const { data } = await db.from("audit_log").select("at, actor, table_name, action, diff").eq("household_id", hid).order("at", { ascending: false }).limit(limit);
  return ((data ?? []) as Row[]).map((r) => ({
    at: r.at,
    who: !r.actor ? "Sistema" : r.actor === userId ? "Você" : people.find((p) => p.id === r.actor)?.email ?? "Pessoa removida",
    what: label(r),
  }));
}
