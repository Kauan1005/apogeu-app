import { controller } from "@/lib/legal";

// RFC 9116: como relatar uma falha de segurança.
export async function GET(req: Request) {
  const c = controller();
  const origin = new URL(req.url).origin;
  const expires = new Date(Date.now() + 365 * 864e5).toISOString();
  const body = [
    c.email ? `Contact: mailto:${c.email}` : `Contact: ${origin}/privacidade`,
    `Expires: ${expires}`,
    "Preferred-Languages: pt-BR, en",
    `Policy: ${origin}/privacidade`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } });
}
