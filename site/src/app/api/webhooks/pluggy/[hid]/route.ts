import { NextResponse } from "next/server";
import { handlePluggyWebhook } from "@/lib/webhook";

// Webhook da conta Meu Pluggy própria de uma casa: segredo derivado só dela e só itens dela.
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ hid: string }> }) {
  const { hid } = await params;
  if (!/^[0-9a-f-]{36}$/.test(hid)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return handlePluggyWebhook(req, hid);
}
