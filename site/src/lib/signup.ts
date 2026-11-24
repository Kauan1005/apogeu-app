import "server-only";
import { createHmac } from "node:crypto";

/** Hash do código de convite com o pepper do servidor: o banco nunca guarda o código. */
export function hashSignupCode(code: string) {
  const pepper = process.env.DOC_HASH_PEPPER ?? "";
  if (pepper.length < 16) throw new Error("DOC_HASH_PEPPER ausente");
  return createHmac("sha256", pepper).update(code.replace(/[^A-Za-z0-9]/g, "").toUpperCase()).digest("hex");
}
