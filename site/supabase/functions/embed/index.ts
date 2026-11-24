// Edge Function: gera embedding gte-small (384 dimensões) com o modelo embutido do Supabase.
// Só aceita chamadas com o segredo EMBED_SECRET (o mesmo do .env.local do Next.js).
// Publicar: npx supabase secrets set EMBED_SECRET=... && npx supabase functions deploy embed --no-verify-jwt
const session = new Supabase.ai.Session("gte-small");

Deno.serve(async (req) => {
  const auth = req.headers.get("x-embed-secret") ?? "";
  const secret = Deno.env.get("EMBED_SECRET") ?? "";
  const a = new TextEncoder().encode(auth), b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  if (!secret || diff !== 0) return new Response("forbidden", { status: 403 });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const { text } = await req.json();
  if (typeof text !== "string" || !text.trim()) return new Response("bad request", { status: 400 });

  const embedding = await session.run(text.slice(0, 500), { mean_pool: true, normalize: true });
  return Response.json({ embedding });
});
