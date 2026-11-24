import "server-only";
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dumpHousehold, keyFingerprint, stripKeys } from "./backup";

/**
 * Backup para fora do Supabase: todas as casas, cifrado com AES-256-GCM antes de sair do servidor.
 * A chave é derivada (HKDF) da DOC_ENC_KEY: quem tiver só o arquivo não lê nada, e a mesma chave que você já guarda abre o backup.
 * Não leva comprovantes anexados (arquivos); eles ficam só no backup interno.
 *
 * Formato: "APGB1" (5 bytes) + iv (12) + tag (16) + conteúdo (JSON compactado e cifrado).
 */
export const BACKUP_MAGIC = "APGB1";

export function backupKey() {
  const ikm = Buffer.from(process.env.DOC_ENC_KEY ?? "", "base64");
  if (ikm.length !== 32) throw new Error("DOC_ENC_KEY ausente ou inválida");
  return Buffer.from(hkdfSync("sha256", ikm, Buffer.from("apogeu-backup"), Buffer.from("v1"), 32));
}

export async function exportAllEncrypted(admin: SupabaseClient) {
  const { data: hhs } = await admin.from("households").select("*");
  const households = [];
  for (const h of hhs ?? []) {
    const data = await dumpHousehold(admin, h.id as string);
    households.push({ household_id: h.id, household: h, data: stripKeys(data, ["embedding"]) });
  }
  const payload = { format: "apogeu-backup-externo", version: 1, created_at: new Date().toISOString(), key_fingerprint: keyFingerprint(), households };
  const plain = gzipSync(Buffer.from(JSON.stringify(payload)));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", backupKey(), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return { file: Buffer.concat([Buffer.from(BACKUP_MAGIC), iv, c.getAuthTag(), body]), households: households.length };
}
