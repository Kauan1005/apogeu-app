import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Saúde do site para o monitor externo (GitHub Actions, ver .github/workflows/uptime.yml): responde 200 só se o site
 * está de pé E o banco responde. Público de propósito e sem nenhum dado: só { ok: true } ou { ok: false }.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { error } = await Promise.race([
      createServiceClient().from("households").select("id", { head: true, count: "estimated" }).limit(1),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
    ]);
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers });
  }
}
