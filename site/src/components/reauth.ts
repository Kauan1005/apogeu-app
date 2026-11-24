"use client";
import { useRouter } from "next/navigation";

/** Exclusões pedem o 2FA de novo se o último código tem mais de 15 minutos: o servidor responde { reauth: true }. */
export function useReauth(next: string) {
  const router = useRouter();
  return (r: unknown) => {
    if (r && typeof r === "object" && "reauth" in r && (r as { reauth?: boolean }).reauth) {
      router.push(`/mfa?reauth=1&next=${encodeURIComponent(next)}`);
      return true;
    }
    return false;
  };
}
