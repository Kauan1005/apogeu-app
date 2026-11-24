import "server-only";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Todas as tabelas com dados do household (exportação LGPD e backup semanal usam a mesma lista).
export const HOUSEHOLD_TABLES = [
  "categories", "connections", "accounts", "account_pots", "transactions", "transaction_versions", "transaction_splits", "tags", "transaction_tags",
  "attachments", "payees", "rules", "bills", "bill_occurrences", "budgets", "goals", "goal_contributions", "recurring_flags", "savings_nudges", "saved_filters",
  "holdings", "holding_values", "net_worth_snapshots", "household_members", "household_invites", "audit_log",
] as const;

export async function dumpHousehold(db: SupabaseClient, hid: string) {
  const out: Record<string, unknown[]> = {};
  for (const t of HOUSEHOLD_TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(t).select("*").eq("household_id", hid).range(from, from + 999);
      if (error || !data?.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    out[t] = rows;
  }
  return out;
}

/** Remove chaves de todos os objetos (recursivo). */
export const stripKeys = (v: unknown, keys: string[]): unknown => {
  if (Array.isArray(v)) return v.map((x) => stripKeys(x, keys));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)).map(([k, x]) => [k, stripKeys(x, keys)]));
  return v;
};

const KEEP = 8;
const BUCKET = "backups";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export async function listBackups(db: SupabaseClient, hid: string) {
  const { data } = await db.storage.from(BUCKET).list(hid, { limit: 100, sortBy: { column: "name", order: "desc" } });
  return (data ?? []).filter((f) => f.name.endsWith(".json.gz")).map((f) => ({
    name: f.name, path: `${hid}/${f.name}`, size: Number((f.metadata as { size?: number } | null)?.size ?? 0), created_at: f.created_at ?? null,
  }));
}

const MAX_FILES_BYTES = 25 * 1024 * 1024;

/** Impressão digital da chave dos documentos (não revela a chave): confere na restauração se é a mesma. */
export const keyFingerprint = () => createHash("sha256").update(process.env.DOC_ENC_KEY ?? "").digest("hex").slice(0, 12);

/** Comprovantes anexados (arquivos do Storage) em base64, até 25 MB no total. */
async function dumpFiles(admin: SupabaseClient, rows: unknown[]) {
  const files: { path: string; type: string; base64: string }[] = [];
  let total = 0, skipped = 0;
  for (const r of rows as { storage_path: string; household_id: string }[]) {
    // só arquivos da pasta desta casa (o cliente de serviço enxerga todas)
    if (!r.storage_path.startsWith(`${r.household_id}/`) || r.storage_path.includes("..")) { skipped++; continue; }
    const { data } = await admin.storage.from("attachments").download(r.storage_path);
    if (!data) { skipped++; continue; }
    const buf = Buffer.from(await data.arrayBuffer());
    if (total + buf.length > MAX_FILES_BYTES) { skipped++; continue; }
    total += buf.length;
    files.push({ path: r.storage_path, type: data.type || "application/octet-stream", base64: buf.toString("base64") });
  }
  return { files, skipped };
}

/**
 * Gera o backup do household (JSON compactado) no bucket privado "backups" e mantém os 8 mais recentes.
 * Precisa do cliente de serviço: só o servidor grava no bucket. Os embeddings ficam de fora (são recalculáveis).
 */
export async function makeBackup(admin: SupabaseClient, hid: string, reason: "semanal" | "manual") {
  const data = await dumpHousehold(admin, hid);
  const { data: household } = await admin.from("households").select("*").eq("id", hid).single();
  const attachments = await dumpFiles(admin, data.attachments ?? []);
  const payload = {
    format: "fluxo-backup", version: 2, created_at: new Date().toISOString(), reason, household_id: hid,
    key_fingerprint: keyFingerprint(), household, data: stripKeys(data, ["embedding"]),
    files: attachments.files, files_skipped: attachments.skipped,
  };
  const gz = gzipSync(Buffer.from(JSON.stringify(payload)));
  const name = `${today()}-${reason}-${Date.now().toString(36)}.json.gz`;
  const { error } = await admin.storage.from(BUCKET).upload(`${hid}/${name}`, gz, { contentType: "application/gzip", upsert: false });
  if (error) throw new Error(`backup: ${error.message}`);
  const all = await listBackups(admin, hid);
  const old = all.slice(KEEP).map((f) => f.path);
  if (old.length) await admin.storage.from(BUCKET).remove(old);
  return { name, size: gz.length, rows: Object.values(data).reduce((s, r) => s + r.length, 0) };
}

/** Semanal: só gera se o último backup tiver 7 dias ou mais. */
export async function weeklyBackupDue(admin: SupabaseClient, hid: string) {
  const last = (await listBackups(admin, hid))[0];
  if (!last) return true;
  const day = last.name.slice(0, 10);
  return (Date.parse(today()) - Date.parse(day)) / 864e5 >= 7;
}
