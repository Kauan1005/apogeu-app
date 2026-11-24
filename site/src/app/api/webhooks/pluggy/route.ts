import { handlePluggyWebhook } from "@/lib/webhook";

// Webhook da conta Meu Pluggy do site (casas criadas pelo administrador). Detalhes em src/lib/webhook.ts.
export const maxDuration = 300;

export async function POST(req: Request) {
  return handlePluggyWebhook(req, null);
}
