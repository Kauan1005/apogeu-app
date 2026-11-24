// Service worker mínimo: deixa o app instalável e guarda só arquivos estáticos e a tela /offline (que não tem dado nenhum).
// Dados financeiros e rotas de API nunca são guardados em cache aqui. O resumo para abrir sem internet fica no
// localStorage do aparelho (src/lib/offline.ts), nunca neste cache.
const CACHE = "apogeu-static-v4"; // o mesmo nome de src/lib/offline.ts
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/offline")).catch(() => {}));
});
// ao atualizar, apaga caches de versões anteriores
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // sem rede, abrir uma página do app mostra a tela /offline (a rede continua mandando sempre que existe)
  if (e.request.mode === "navigate" && e.request.method === "GET" && url.origin === location.origin && !url.pathname.startsWith("/api/") && url.pathname !== "/offline") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/offline", { ignoreVary: true }).then((r) => r || Response.error())));
    return;
  }
  if (e.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith("/_next/static/")) return;
  e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) || c.add(e.request).then(() => c.match(e.request))));
});

// Avisos (contas a vencer). O texto vem do servidor; ao tocar, abre a tela certa do app.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Apogeu", {
    body: d.body || "", tag: d.tag, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: d.url || "/" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const path = (e.notification.data && e.notification.data.url) || "/";
  const target = new URL(path.startsWith("/") ? path : "/", location.origin).href; // só abre páginas do próprio app
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    const w = ws.find((c) => c.url.startsWith(location.origin));
    return w ? w.navigate(target).then((c) => (c || w).focus()) : self.clients.openWindow(target);
  }));
});
