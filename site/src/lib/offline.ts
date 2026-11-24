/**
 * Abrir o app sem internet: guarda NESTE aparelho só os totais do Painel (sem extrato, sem nomes de lançamentos).
 * Apaga ao sair, ao bloquear por inatividade e se a pessoa desligar em Ajustes. Mostra no máximo 2 horas depois da última atividade.
 */
export const SNAP_KEY = "apogeu-snap";
export const OFFLINE_FLAG = "apogeu-offline"; // "0" = desligado
export const ACTIVITY_KEY = "apogeu-last-activity";
export const CACHE_NAME = "apogeu-static-v4"; // o mesmo nome do public/sw.js
export const IDLE_MS = 120 * 60 * 1000;

export type Snapshot = {
  month: string;
  free: number | null; // livre para gastar (só no mês atual)
  perDay: number;
  balance: number;
  income: number;
  expense: number;
  cats: { label: string; cents: number; color: string }[];
  expenseTotal: number;
  bills: { name: string; day: string; mon: string; cents: number; status: string }[];
};
export type StoredSnapshot = Snapshot & { savedAt: number };

export const offlineEnabled = () => { try { return localStorage.getItem(OFFLINE_FLAG) !== "0"; } catch { return false; } };
export const clearSnapshot = () => { try { localStorage.removeItem(SNAP_KEY); } catch { /* ok */ } };

export function saveSnapshot(s: Snapshot) {
  if (!offlineEnabled()) return;
  try { localStorage.setItem(SNAP_KEY, JSON.stringify({ ...s, savedAt: Date.now() } satisfies StoredSnapshot)); } catch { /* sem armazenamento */ }
}

/** Lê o resumo guardado, a menos que o aparelho esteja parado há mais de 2 horas (aí apaga). */
export function readSnapshot(now = Date.now()): StoredSnapshot | null {
  try {
    const last = Number(localStorage.getItem(ACTIVITY_KEY));
    if (!last || now - last >= IDLE_MS) { clearSnapshot(); return null; }
    const raw = localStorage.getItem(SNAP_KEY);
    return raw ? (JSON.parse(raw) as StoredSnapshot) : null;
  } catch { return null; }
}

/** Deixa guardados (no cache do app) a tela /offline e os arquivos que ela usa, para abrir sem rede. No máximo uma vez por dia. */
export async function warmOffline() {
  try {
    if (!("caches" in window) || !("serviceWorker" in navigator)) return;
    // só faz sentido com o service worker registrado (no desenvolvimento local ele não é); sem ele, não espera para sempre
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
    if (!reg) return;
    const cache = await caches.open(CACHE_NAME);
    const day = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem("apogeu-offline-warm") === day && (await cache.match("/offline", { ignoreVary: true }))) return;
    const res = await fetch("/offline", { cache: "reload", credentials: "same-origin" });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put("/offline", res);
    const assets = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\\\s)]+\.(?:js|css)/g)].map((m) => m[0]))];
    for (const u of assets) {
      if (await cache.match(u)) continue;
      const r = await fetch(u).catch(() => null);
      if (!r?.ok) continue;
      await cache.put(u, r.clone());
      if (u.endsWith(".css")) {
        // fontes citadas no CSS
        for (const m of (await r.text()).matchAll(/\/_next\/static\/media\/[^)"'\s]+/g)) {
          if (await cache.match(m[0])) continue;
          const f = await fetch(m[0]).catch(() => null);
          if (f?.ok) await cache.put(m[0], f);
        }
      }
    }
    localStorage.setItem("apogeu-offline-warm", day);
  } catch { /* sem rede ou sem cache: segue sem o modo offline */ }
}
