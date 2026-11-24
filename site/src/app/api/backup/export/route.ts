import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { bearerAuthorized } from "@/lib/cron-auth";
import { exportAllEncrypted } from "@/lib/backup-export";

// Chamada só pelo GitHub Actions (backup mensal fora do Supabase). Exige o segredo BACKUP_EXPORT_SECRET
// e devolve o arquivo já cifrado: sem a DOC_ENC_KEY ele não revela nada.
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!bearerAuthorized(req, process.env.BACKUP_EXPORT_SECRET)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const { file, households } = await exportAllEncrypted(createServiceClient());
    return new NextResponse(new Uint8Array(file), {
      headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="apogeu-${new Date().toISOString().slice(0, 10)}.bin"`, "cache-control": "no-store", "x-households": String(households) },
    });
  } catch {
    return NextResponse.json({ error: "export_failed" }, { status: 500 });
  }
}
