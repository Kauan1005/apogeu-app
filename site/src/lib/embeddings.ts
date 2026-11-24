import "server-only";

// gte-small roda dentro do Supabase (Edge Function `embed`, Supabase.ai). Grátis e sem enviar dados a terceiros.
// Se a função ainda não foi publicada, devolve null e a categorização usa trigramas do Postgres.
let unavailableUntil = 0;

export async function embed(text: string): Promise<number[] | null> {
  if (Date.now() < unavailableUntil) return null;
  const secret = process.env.EMBED_SECRET;
  if (!secret) return null;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/embed`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-embed-secret": secret },
      body: JSON.stringify({ text: text.slice(0, 500) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const { embedding } = (await res.json()) as { embedding: number[] };
    return Array.isArray(embedding) && embedding.length === 384 ? embedding : null;
  } catch {
    unavailableUntil = Date.now() + 10 * 60 * 1000; // tenta de novo em 10 minutos
    return null;
  }
}
