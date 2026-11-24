// Coisas que ainda não tinham teste: bloqueio por inatividade (relógio simulado e computador dormindo),
// proteções da sincronização e do webhook, ícones e manifesto, telas sem rolagem lateral no celular
// e varredura automática de acessibilidade (axe-core, WCAG 2 A/AA).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { BASE, RUN, adminDb, browser, done, http, login, ok, until } from "./lib.mjs";

console.log(`\n== Extras (${BASE}) · rodada ${RUN}`);
const admin = await adminDb();
const s = await login();
const h = http(s);
const anon = http(null);
const uuid = (n) => `00000000-0000-4000-${n}-${String(Date.now()).slice(-12)}`;

// ------------------------------------------------------------ manifesto, ícones e service worker
const man = await fetch(BASE + "/manifest.webmanifest").then((r) => r.json());
ok(man.name?.startsWith("Apogeu") && man.short_name === "Apogeu", "manifesto do app com o nome Apogeu");
for (const ic of man.icons) {
  const r = await fetch(BASE + ic.src);
  ok(r.status === 200 && (r.headers.get("content-type") ?? "").includes(ic.type.split("+")[0].replace("image/svg", "image/svg")), `ícone ${ic.src} (${ic.sizes}) existe`);
}
ok((await fetch(BASE + "/favicon.ico")).status === 200, "favicon.ico existe");
const sw = await fetch(BASE + "/sw.js").then((r) => r.text());
ok(sw.includes("apogeu-static") && sw.includes("/_next/static/"), "service worker só guarda arquivos estáticos (nada de dados)");


// ------------------------------------------------------------ sincronização e webhook
const other = (await admin.from("households").insert({ uses_app_pluggy: false }).select("id").single()).data.id;
const itemOther = uuid("8111"), itemMine = uuid("8222");
try {
  await admin.from("connections").insert({ household_id: other, provider_item_id: itemOther, institution: `Outra casa ${RUN}`, status: "UPDATED" });
  const steal = await h.post("/api/pluggy/sync", { itemId: itemOther });
  ok(steal.status === 403, "colar o ID de um banco de outra casa é recusado (403)");
  const { error: move } = await admin.from("connections").update({ household_id: s.hid }).eq("provider_item_id", itemOther);
  ok(!!move, "o banco de dados impede mover uma conexão para outra casa");

  await admin.from("connections").insert({ household_id: s.hid, provider_item_id: itemMine, institution: `Minha ${RUN}`, status: "UPDATED", last_synced_at: new Date().toISOString() });
  const soon = await h.post("/api/pluggy/sync", {});
  ok(soon.status === 429, "“sincronizar agora” respeita o intervalo de 2 minutos (429)");

  const ghost = uuid("8333");
  const w = await fetch(BASE + "/api/webhooks/pluggy", { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": process.env.PLUGGY_WEBHOOK_SECRET }, body: JSON.stringify({ eventId: `extra-${RUN}`, event: "item/created", itemId: ghost }) });
  ok(w.status === 200, "aviso de banco desconhecido é aceito sem erro");
  ok(!(await admin.from("connections").select("id").eq("provider_item_id", ghost).maybeSingle()).data, "banco que não existe na Pluggy não é adotado por nenhuma casa");
  await admin.from("webhook_events").delete().eq("event_id", `extra-${RUN}`);
} finally {
  await admin.from("connections").delete().in("provider_item_id", [itemOther, itemMine]);
  await admin.from("households").delete().eq("id", other);
}

// ------------------------------------------------------------ navegador: celular, acessibilidade e bloqueio
const axeSrc = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const b = await browser();
const PAGES = ["/", "/transacoes", "/revisar", "/contas", "/cartoes", "/orcamentos", "/assinaturas", "/patrimonio", "/relatorios", "/perguntar", "/conexoes", "/ajustes", "/mais"];
try {
  // sem rolagem lateral no celular
  const mob = await b.newContext({ viewport: { width: 390, height: 844 } });
  await mob.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const mp = await mob.newPage();
  const wide = [];
  for (const p of PAGES) {
    await mp.goto(BASE + p); await mp.waitForLoadState("networkidle").catch(() => {});
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) wide.push(`${p} (+${over}px)`);
  }
  ok(!wide.length, `nenhuma tela rola para o lado no celular${wide.length ? ": " + wide.join(", ") : ""}`);
  await mob.close();

  // acessibilidade: axe-core com as regras WCAG 2 A e AA (falha só nos problemas sérios e críticos)
  const ax = await b.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true });
  await ax.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const ap = await ax.newPage();
  const problems = [];
  for (const p of [...PAGES, "/login", "/criar-conta", "/privacidade"]) {
    if (["/login", "/criar-conta", "/privacidade"].includes(p)) await ax.clearCookies();
    await ap.goto(BASE + p); await ap.waitForLoadState("networkidle").catch(() => {});
    await ap.evaluate(axeSrc);
    const res = await ap.evaluate(async () => {
      // @ts-expect-error axe global
      const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
      return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}×${v.nodes.length} (${v.nodes[0]?.target?.join(" ")})`);
    });
    if (res.length) problems.push(`${p}: ${res.join("; ")}`);
  }
  ok(!problems.length, `acessibilidade sem problemas sérios (axe WCAG 2 AA)${problems.length ? ":\n    " + problems.join("\n    ") : ""}`);
  await ax.close();

  // bloqueio depois de 2 horas sem uso (relógio simulado)
  const lc = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await lc.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const lp = await lc.newPage();
  await lp.clock.install();
  await lp.goto(BASE + "/");
  await lp.waitForLoadState("networkidle"); await lp.waitForTimeout(1500); // o bloqueio só começa a contar depois que a página carrega
  await lp.clock.fastForward("01:59:00");
  ok(new URL(lp.url()).pathname === "/", "com 1h59 parado, continua aberto");
  await lp.clock.fastForward("00:02:00");
  await lp.clock.resume(); // deixa o tempo correr de novo (o "sair" usa temporizadores internos)
  ok(await until(async () => lp.url().includes("/login?bloqueado=1"), 10000), "com 2h01 parado, bloqueia e volta para o login");
  ok((await lp.locator("main").innerText()).includes("Sessão bloqueada"), "o login avisa que a sessão foi bloqueada");
  await lc.close();

  // computador dormindo: o cronômetro não andou, mas o relógio real sim
  const sc = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await sc.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const sp = await sc.newPage();
  await sp.clock.install();
  await sp.goto(BASE + "/");
  await sp.waitForLoadState("networkidle"); await sp.waitForTimeout(1500);
  await sp.clock.setSystemTime(Date.now() + 3 * 3600 * 1000); // pula 3 h sem disparar cronômetros, como no sono
  await sp.clock.resume();
  await sp.evaluate(() => window.dispatchEvent(new Event("focus")));
  ok(await until(async () => sp.url().includes("/login?bloqueado=1"), 10000), "depois de o computador “dormir” 3 h, ao voltar a página bloqueia");
  await sc.close();

  // o bloqueio de um aparelho não derruba os outros
  ok((await h.get("/")).status === 200, "o bloqueio por inatividade sai só daquele aparelho (a outra sessão segue)");
} finally {
  await b.close();
}
ok((await anon.get("/")).loc?.includes("/login"), "sem login continua indo para o login");
done("Extras");
