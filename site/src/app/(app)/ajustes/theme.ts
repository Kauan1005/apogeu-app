"use server";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/supabase/server";

export type Theme = "dark" | "light" | "auto";

/** Aparência: guardada num cookie (lido no servidor, sem piscar ao abrir). Escuro é o padrão. */
export async function setTheme(theme: Theme) {
  await requireSession();
  if (theme !== "dark" && theme !== "light" && theme !== "auto") return { error: "Opção inválida." };
  (await cookies()).set("apogeu-theme", theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return { ok: true };
}
