import http from "node:http";

/** Proxy local para o site (BASE) que dá para "derrubar" e "religar": é assim que se simula ficar sem internet. */
export function startProxy(target) {
  let up = true;
  const host = new URL(target).host;
  const server = http.createServer(async (req, res) => {
    if (!up) { req.socket.destroy(); return; }
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = { ...req.headers, host };
      delete headers["accept-encoding"];
      delete headers.origin; delete headers.referer;
      const r = await fetch(target + req.url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks), redirect: "manual" });
      const out = {};
      r.headers.forEach((v, k) => { if (!["content-encoding", "content-length", "transfer-encoding", "set-cookie", "connection"].includes(k)) out[k] = k === "location" ? v.replace(target, "") : v; });
      const sc = r.headers.getSetCookie?.() ?? [];
      if (sc.length) out["set-cookie"] = sc.map((c) => c.replace(/;s*secure/i, "").replace(/;s*domain=[^;]+/i, ""));
      res.writeHead(r.status, out);
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch { res.statusCode = 502; res.end(); }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    port: server.address().port,
    setUp: (v) => { up = v; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  })));
}
