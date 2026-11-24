import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM para o CPF/CNPJ das contrapartes. A chave fica só no ambiente do servidor (DOC_ENC_KEY),
// nunca no banco: um vazamento do banco sozinho não revela os documentos.
function key() {
  const k = Buffer.from(process.env.DOC_ENC_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("DOC_ENC_KEY ausente ou inválida (32 bytes em base64)");
  return k;
}

/** Formato: v1.<iv>.<tag>.<cifrado> (base64url) */
export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const [v, iv, tag, data] = token.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const formatDoc = (d: string) => {
  const n = d.replace(/\D/g, "");
  if (n.length === 11) return `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}`;
  if (n.length === 14) return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`;
  return n;
};
