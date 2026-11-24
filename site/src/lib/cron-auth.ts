import "server-only";
import { timingSafeEqual } from "node:crypto";

/** A Vercel Cron envia "Authorization: Bearer <CRON_SECRET>"; comparação em tempo constante. */
export function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  return !!secret && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

/** Compara o "Authorization: Bearer ..." da chamada com um segredo do ambiente, em tempo constante. */
export function bearerAuthorized(req: Request, secret: string | undefined) {
  const want = secret ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  return want.length >= 24 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
