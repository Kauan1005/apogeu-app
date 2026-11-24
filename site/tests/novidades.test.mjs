// Busca rápida (Ctrl+F), "Desfazer" (categoria, lixeira, aceitar todas), comparação de entradas no Painel
// e a tabela dos avisos no celular (cada pessoa só vê e apaga as próprias inscrições).
import { BASE, RUN, adminDb, browser, done, http, login, ok, totp, until } from "./lib.mjs";

console.log(`\n== Novidades (${BASE}) · rodada ${RUN}`);
const admin = await adminDb();
const s = await login();
const h = http(s);
const sim = (b) => h.post("/api/dev/simulate-pix", b).then((r) => r.json.transaction);

const { data: cats } = await s.db.from("categories").select("id, slug, name").eq("household_id", s.hid);
const cat = (slug) => cats.find((c) => c.slug === slug);
const a = await sim({ name: `Mercado Desfaz ${RUN}`, amount: 87.5 });
const b2 = await sim({ name: `Lixeira Desfaz ${RUN}`, amount: 12 });
const r1 = await sim({ name: `Fila Um ${RUN}`, amount: 30 });
const r2 = await sim({ name: `Fila Dois ${RUN}`, amount: 40 });
const ids = [a.id, b2.id, r1.id, r2.id];
await admin.from("transactions").update({ category_id: cat("alimentacao").id, category_source: "similarity", confidence: 0.5, status: "ok" }).eq("id", a.id);
await admin.from("transactions").update({ category_id: cat("lazer").id, status: "review", confidence: 0.4 }).in("id", [r1.id, r2.id]);

// ------------------------------------------------------------ avisos no celular: tabela protegida
const sub = { endpoint: `https://push.example.test/${RUN}`, p256dh: "B".repeat(87), auth: "A".repeat(22) };
const { error: insErr } = await s.db.from("push_subscriptions").insert({ household_id: s.hid, ...sub });
ok(!insErr, "a pessoa registra o próprio aparelho para avisos");
const other = (await admin.from("households").insert({ uses_app_pluggy: false }).select("id").single()).data.id;
const { error: crossErr } = await s.db.from("push_subscriptions").insert({ household_id: other, ...sub, endpoint: sub.endpoint + "x" });
ok(!!crossErr, "não dá para registrar aviso em nome de outra casa");
const { data: seen } = await s.db.from("push_subscriptions").select("id, endpoint");
ok(seen?.length === 1 && !("p256dh" in seen[0]), "vê só as próprias inscrições, sem as chaves");
const { error: keyRead } = await s.db.from("push_subscriptions").select("p256dh");
ok(!!keyRead, "as chaves do aparelho não são legíveis pelo navegador");
await s.db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
ok(!(await admin.from("push_subscriptions").select("id").eq("endpoint", sub.endpoint).maybeSingle()).data, "a pessoa desliga (apaga) o próprio aviso");
await admin.from("households").delete().eq("id", other);
const sw = await fetch(BASE + "/sw.js").then((r) => r.text());
ok(sw.includes('"push"') && sw.includes("notificationclick"), "service worker mostra o aviso e abre a tela certa ao tocar");

// ------------------------------------------------------------ app no celular (Android e iPhone)
const links = await fetch(BASE + "/.well-known/assetlinks.json");
const al = await links.json().catch(() => null);
ok(links.status === 200 && (links.headers.get("content-type") ?? "").includes("json") && al?.[0]?.target?.package_name === "app.vercel.apogeu_financas.twa" && /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(al?.[0]?.target?.sha256_cert_fingerprints?.[0] ?? ""), "assetlinks.json público, com o pacote e a impressão digital do app Android");
const apk = await fetch(BASE + "/apogeu.apk");
const apkBytes = Buffer.from(await apk.arrayBuffer());
ok(apk.status === 200 && apkBytes.subarray(0, 2).toString() === "PK" && apkBytes.length > 300000, "o APK do Android é baixável sem login (arquivo zip válido)");
const inst = http(null);
const ip = await inst.get("/instalar");
ok(ip.status === 200 && ip.text.includes("Instalar o app") && ip.text.includes("Baixar o Apogeu"), "página /instalar abre sem login com o passo a passo");
const man2 = await fetch(BASE + "/manifest.webmanifest").then((r) => r.json());
ok(man2.id === "/" && man2.display === "standalone" && man2.shortcuts?.length >= 2, "manifesto com atalhos e modo app");

const br = await browser();
try {
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const p = await ctx.newPage();

  // ------------------------------------------------------------ busca rápida
  await p.goto(BASE + "/");
  await p.waitForLoadState("networkidle");
  await p.keyboard.press("Control+f");
  const dlg = p.locator("dialog.qs");
  ok(await until(() => dlg.evaluate((d) => d.open)), "Ctrl+F abre a busca rápida");
  await p.keyboard.type(`Mercado Desfaz ${RUN}`);
  ok(await until(async () => (await dlg.locator("li", { hasText: `Mercado Desfaz ${RUN}` }).count()) > 0), "a busca acha a transação pelo nome");
  await p.keyboard.type("x");
  await p.keyboard.press("Backspace");
  await until(async () => (await dlg.locator("li.on", { hasText: `Mercado Desfaz ${RUN}` }).count()) > 0 || (await dlg.locator("li", { hasText: `Mercado Desfaz ${RUN}` }).count()) > 0);
  await dlg.locator("li", { hasText: `Mercado Desfaz ${RUN}` }).first().click();
  ok(await until(() => p.url().includes(`abrir=${a.id}`)), "escolher o resultado leva à transação");
  ok(await until(async () => (await p.locator("dialog.modal[open]", { hasText: `Mercado Desfaz ${RUN}` }).count()) > 0), "a transação já abre nos detalhes");
  await p.keyboard.press("Escape");
  await p.keyboard.press("Control+f");
  ok(await until(() => dlg.evaluate((d) => d.open)), "Ctrl+F abre a busca em qualquer tela");
  await p.keyboard.type("orçam");
  ok(await until(async () => (await dlg.locator("li", { hasText: "Orçamentos e metas" }).count()) > 0), "a busca acha telas pelo nome");
  await p.keyboard.press("Control+f");
  ok(await until(async () => !(await dlg.evaluate((d) => d.open))), "Ctrl+F de novo fecha e devolve a busca do navegador");

  // ------------------------------------------------------------ desfazer troca de categoria
  await p.goto(BASE + "/transacoes");
  const sel = p.getByLabel(`Categoria de Mercado Desfaz ${RUN}`);
  await sel.waitFor();
  await sel.selectOption(cat("lazer").id);
  const note = p.locator(".note");
  ok(await until(async () => (await note.count()) > 0 && (await note.innerText()).includes("Desfazer")), "trocar a categoria mostra o aviso com Desfazer");
  ok(await until(async () => (await admin.from("transactions").select("category_id").eq("id", a.id).single()).data.category_id === cat("lazer").id), "a troca é salva");
  await note.getByRole("button", { name: "Desfazer" }).click();
  ok(await until(async () => {
    const t = (await admin.from("transactions").select("category_id, category_source").eq("id", a.id).single()).data;
    return t.category_id === cat("alimentacao").id && t.category_source === "similarity";
  }), "Desfazer volta a categoria e a origem anteriores");

  // ------------------------------------------------------------ desfazer lixeira
  await p.getByText(`Lixeira Desfaz ${RUN}`).first().click();
  const tdlg = p.locator("dialog.modal[open]");
  await tdlg.waitFor();
  await tdlg.getByRole("button", { name: "Mover para a lixeira" }).click();
  ok(await until(async () => !!(await admin.from("transactions").select("deleted_at").eq("id", b2.id).single()).data.deleted_at), "mover para a lixeira funciona");
  await p.locator(".note").getByRole("button", { name: "Desfazer" }).click();
  ok(await until(async () => !(await admin.from("transactions").select("deleted_at").eq("id", b2.id).single()).data.deleted_at), "Desfazer tira da lixeira");

  // ------------------------------------------------------------ revisar: aceitar todas e desfazer
  await p.goto(BASE + "/revisar");
  const all = p.getByRole("button", { name: /Aceitar as \d+ sugestões/ });
  ok(await until(async () => (await all.count()) > 0), "Revisar oferece aceitar todas as sugestões num toque");
  await all.click();
  ok(await until(async () => (await admin.from("transactions").select("status").in("id", [r1.id, r2.id])).data.every((t) => t.status === "ok")), "aceitar todas confirma a fila inteira");
  await p.locator(".note").getByRole("button", { name: "Desfazer" }).click();
  ok(await until(async () => (await admin.from("transactions").select("status").in("id", [r1.id, r2.id])).data.every((t) => t.status === "review")), "Desfazer devolve tudo para a fila");

  // ------------------------------------------------------------ contas a pagar: sino (sem service worker em localhost, fica oculto)
  await p.goto(BASE + "/contas");
  await p.waitForSelector(".sk", { state: "detached" }).catch(() => {});
  ok((await p.locator("header.top").count()) === 1, "Contas a pagar abre com o novo cabeçalho");

  // ------------------------------------------------------------ senha: olho para mostrar e esconder
  const lg = await br.newContext({ viewport: { width: 390, height: 844 } });
  const lp = await lg.newPage();
  await lp.goto(BASE + "/login");
  const pwd = lp.locator('input[name="password"]');
  await pwd.fill("minha-senha-123");
  ok((await pwd.getAttribute("type")) === "password", "a senha do login começa escondida");
  await lp.getByRole("button", { name: "Mostrar a senha" }).click();
  ok((await pwd.getAttribute("type")) === "text" && (await pwd.inputValue()) === "minha-senha-123", "o olho mostra a senha digitada");
  await lp.getByRole("button", { name: "Esconder a senha" }).click();
  ok((await pwd.getAttribute("type")) === "password", "e esconde de novo");
  await lg.close();
  await p.goto(BASE + "/ajustes");
  ok(await p.evaluate(() => [...document.styleSheets].some((sh) => [...sh.cssRules].some((r) => r.media?.mediaText.includes("display-mode: standalone") && [...r.cssRules].some((c) => c.selectorText?.includes(".install-link") && c.style.display === "none")))), "dentro do app instalado a opção “Instalar o app” fica escondida");
  ok((await p.locator(".install-link").count()) > 0 && (await p.locator(".install-link").first().isVisible()), "no navegador a opção “Instalar o app” continua visível");

  // ------------------------------------------------------------ botões: afundam ao apertar e o Sair mostra "Saindo…"
  await p.goto(BASE + "/contas");
  await p.waitForLoadState("networkidle");
  const alvo = p.getByRole("button", { name: /valores/ });
  const box = await alvo.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  ok(await alvo.evaluate((el) => el.hasAttribute("data-press") && getComputedStyle(el).transform !== "none"), "o botão afunda (escala e opacidade) assim que é apertado");
  await p.mouse.up();
  await until(async () => !(await alvo.evaluate((el) => el.hasAttribute("data-press"))));
  // toque rápido simulado dentro da página (sem depender do relógio do teste): logo depois de soltar, ainda está apertado
  ok(await alvo.evaluate((el) => { el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); return el.hasAttribute("data-press"); }), "e fica apertado por um tempo mínimo, mesmo num toque rápido");
  ok(await until(async () => !(await alvo.evaluate((el) => el.hasAttribute("data-press")))), "depois solta sozinho");
  await p.route("**/auth/v1/logout*", async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue().catch(() => {}); });
  await p.locator("header.top .signout").click();
  ok(await until(async () => (await p.locator("header.top .signout").innerText()).includes("Saindo")), "ao apertar Sair o botão já mostra “Saindo…”");
  ok(await p.locator("header.top .signout").isDisabled(), "e fica desativado para não repetir o toque");
  await p.unroute("**/auth/v1/logout*");
  await p.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});

  // ------------------------------------------------------------ 2FA: código copiado é colado e verificado sozinho
  const entrar = async (page) => {
    await page.goto(BASE + "/login");
    await page.getByLabel("E-mail").fill(process.env.TEST_EMAIL);
    await page.locator('input[name="password"]').fill(process.env.TEST_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/mfa/);
    await page.locator('input[name="code"]').waitFor();
    await page.waitForTimeout(1500); // aguarda o fator carregar
  };
  const a2 = await br.newContext({ viewport: { width: 390, height: 844 }, permissions: ["clipboard-read", "clipboard-write"] });
  const ap = await a2.newPage();
  let verifies = 0;
  ap.on("request", (r) => { if (/\/factors\/.+\/(verify|challenge)/.test(r.url()) && r.method() === "POST") verifies++; });
  await entrar(ap);
  await ap.evaluate(() => navigator.clipboard.writeText("000000")); // código errado copiado
  await ap.evaluate(() => window.dispatchEvent(new Event("focus")));
  ok(await until(async () => (await ap.locator(".err").count()) > 0), "um código copiado errado é tentado uma vez e mostra o erro");
  const depois1 = verifies;
  await ap.evaluate(() => window.dispatchEvent(new Event("focus")));
  await ap.waitForTimeout(1200);
  ok(verifies === depois1, "o mesmo código errado não é reenviado sozinho (sem laço de tentativas)");
  await ap.evaluate((c) => navigator.clipboard.writeText(c), totp(process.env.TEST_TOTP_SECRET));
  await ap.evaluate(() => window.dispatchEvent(new Event("focus")));
  ok(await until(async () => !new URL(ap.url()).pathname.startsWith("/mfa"), 15000), "copiar o código certo e voltar à página entra sozinho, sem colar nem apertar");
  await a2.close();

  const a3 = await br.newContext({ viewport: { width: 390, height: 844 } });
  const ap3 = await a3.newPage();
  await entrar(ap3);
  await ap3.locator('input[name="code"]').pressSequentially(totp(process.env.TEST_TOTP_SECRET));
  ok(await until(async () => !new URL(ap3.url()).pathname.startsWith("/mfa"), 15000), "digitar os 6 dígitos entra sozinho, sem apertar Verificar");
  await a3.close();

  // ------------------------------------------------------------ devoluções: gasto + devolução do mesmo valor se anulam
  const cpfDev = "11144477735";
  const mk = async (name, amount, direction, extra = {}) => { const t = await sim({ name, amount, direction, ...extra }); ids.push(t.id); return t.id; };
  const g1 = await mk(`Loja Devolve ${RUN}`, 10, "out", { cpf: cpfDev, daysAgo: 3 });
  const g2 = await mk(`Loja Devolve ${RUN}`, 10, "in", { cpf: cpfDev, daysAgo: 1 });
  const par = async (...x) => (await admin.from("transactions").select("id, is_internal_transfer, refund_pair_id").in("id", x)).data;
  const [q1, q2] = await par(g1, g2);
  ok(q1.is_internal_transfer && q2.is_internal_transfer && q1.refund_pair_id === q2.id && q2.refund_pair_id === q1.id, "gastei R$ 10 e o mesmo destinatário devolveu R$ 10: os dois se anulam (fora de gastos e entradas)");
  const n1 = await mk(`Cafe Bom ${RUN}`, 12, "out", { daysAgo: 4 });
  const n2 = await mk(`Devolucao Cafe Bom ${RUN}`, 12, "in", { daysAgo: 2 });
  ok((await par(n1, n2)).every((t) => t.is_internal_transfer && t.refund_pair_id), "a devolução sem documento também é reconhecida pelo nome (“Devolução ...”)");
  const p1 = await mk(`Padaria Parcial ${RUN}`, 25.5, "out", { daysAgo: 4 });
  const p2 = await mk(`Padaria Parcial ${RUN}`, 10, "in", { daysAgo: 2 });
  ok((await par(p1, p2)).every((t) => !t.is_internal_transfer && !t.refund_pair_id), "devolução de valor diferente (parcial) não é anulada");
  const l1 = await mk(`Amigo Fixo ${RUN}`, 20, "out", { daysAgo: 30 });
  const l2 = await mk(`Amigo Fixo ${RUN}`, 20, "in", { daysAgo: 2 });
  ok((await par(l1, l2)).every((t) => !t.is_internal_transfer), "Pix comum de volta 28 dias depois (sem a palavra devolução) não é anulado");
  const w1 = await mk(`Loja Antiga ${RUN}`, 15, "out", { daysAgo: 30 });
  const w2 = await mk(`Devolucao Loja Antiga ${RUN}`, 15, "in", { daysAgo: 2 });
  ok((await par(w1, w2)).every((t) => t.is_internal_transfer && t.refund_pair_id), "já uma “Devolução” 28 dias depois é anulada");
  const o1 = await mk(`Lugar Um ${RUN}`, 7, "out", { daysAgo: 3 });
  const o2 = await mk(`Mercado Dois ${RUN}`, 7, "in", { daysAgo: 1 });
  ok((await par(o1, o2)).every((t) => !t.is_internal_transfer), "mesmo valor de destinatários diferentes não é anulado");
  const e1 = await mk(`Zeta Cia ${RUN}`, 5, "in", { daysAgo: 5 });
  const e2 = await mk(`Zeta Cia ${RUN}`, 5, "out", { daysAgo: 1 });
  ok((await par(e1, e2)).every((t) => !t.is_internal_transfer), "entrada anterior ao gasto não é devolução");
  await admin.from("transactions").update({ amount_cents: 900 }).eq("id", g2); // o banco corrigiu o valor da devolução
  await mk(`Gatilho ${RUN}`, 3, "out");
  ok((await par(g1, g2)).every((t) => !t.is_internal_transfer && !t.refund_pair_id), "se o banco corrige o valor, o par é desfeito");
  await admin.from("transactions").update({ amount_cents: 1000 }).eq("id", g2);
  await mk(`Gatilho Dois ${RUN}`, 3, "out");
  ok((await par(g1, g2)).every((t) => t.is_internal_transfer), "e volta a ser anulado quando o valor volta a bater");
  const dp = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await dp.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const dpp = await dp.newPage();
  await dpp.goto(BASE + "/transacoes");
  await dpp.waitForLoadState("networkidle");
  ok(await until(async () => (await dpp.locator("tr", { hasText: `Loja Devolve ${RUN}` }).first().innerText()).includes("anulado")), "na tabela o par aparece com o selo “anulado” ao lado da descrição");
  await dp.close();

  // ------------------------------------------------------------ Conexões: nome e ícone na cor do banco, com brilho suave
  const { randomUUID } = await import("node:crypto");
  const itB = randomUUID(), itM = randomUUID(), itX = randomUUID();
  globalThis.__bankItems = [itB, itM, itX];
  const { data: cB } = await admin.from("connections").insert({ household_id: s.hid, provider_item_id: itB, institution: "MeuPluggy", status: "UPDATED" }).select("id").single();
  const { data: cM } = await admin.from("connections").insert({ household_id: s.hid, provider_item_id: itM, institution: "MeuPluggy", status: "UPDATED" }).select("id").single();
  const { data: cX } = await admin.from("connections").insert({ household_id: s.hid, provider_item_id: itX, institution: "MeuPluggy", status: "UPDATED" }).select("id").single();
  await admin.from("accounts").insert([
    { household_id: s.hid, connection_id: cB.id, provider_account_id: `acc-bank-${RUN}-1`, name: "Banco Bradesco", type: "checking", institution: "MeuPluggy", balance_cents: 49143 },
    { household_id: s.hid, connection_id: cB.id, provider_account_id: `acc-bank-${RUN}-2`, name: "VISA PLATINUM", type: "credit", institution: "MeuPluggy", balance_cents: -218056 },
    { household_id: s.hid, connection_id: cM.id, provider_account_id: `acc-bank-${RUN}-3`, name: "Mercado Pago (Conta Pré-paga)", type: "checking", institution: "MeuPluggy", balance_cents: 3000 },
    { household_id: s.hid, connection_id: cX.id, provider_account_id: `acc-bank-${RUN}-4`, name: "Nubank", type: "checking", institution: "MeuPluggy", balance_cents: 1000 },
    { household_id: s.hid, connection_id: cX.id, provider_account_id: `acc-bank-${RUN}-5`, name: "Banco Inter", type: "checking", institution: "MeuPluggy", balance_cents: 500 },
  ]);
  const bc = await br.newContext({ viewport: { width: 390, height: 844 } });
  await bc.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const bp = await bc.newPage();
  await bp.goto(BASE + "/conexoes");
  await bp.waitForLoadState("networkidle");
  const look = (txt) => bp.locator(".bank-name", { hasText: txt }).first().evaluate((el) => ({ color: getComputedStyle(el).color, shadow: getComputedStyle(el).textShadow }));
  const brad = await look("Banco Bradesco");
  ok(brad.color === "rgb(255, 51, 85)" && brad.shadow !== "none", "o nome do Bradesco aparece na cor do banco com brilho suave");
  const visa = await look("VISA PLATINUM");
  ok(visa.color === "rgb(255, 51, 85)", "o cartão herda a cor do banco da mesma autorização");
  const mpg = await look("Mercado Pago");
  ok(mpg.color === "rgb(31, 195, 255)", "o Mercado Pago aparece na cor azul dele");
  ok((await bp.locator('.bank-tile.lg.glow img[src="/icons/bradesco.svg"]').count()) === 1, "o quadradinho do topo da autorização mostra o logo do Bradesco");
  ok((await bp.locator('.bank-tile.lg.glow img[src="/icons/mercadopago.svg"]').count()) >= 1, "e o do Mercado Pago mostra o logo dele");
  for (const f of ["bradesco", "itau", "santander", "picpay", "neon", "pagseguro", "cora", "bmg", "modal", "nubank", "mercadopago"]) {
    const r = await fetch(`${BASE}/icons/${f}.svg`);
    ok(r.status === 200 && (await r.text()).startsWith("<svg"), `logo ${f}.svg é servido`);
  }
  const nu = await look("Nubank"), inter = await look("Banco Inter");
  ok(nu.color === "rgb(178, 77, 255)" && inter.color === "rgb(255, 122, 47)", "numa mesma autorização com dois bancos, cada um tem a própria cor (roxo e laranja)");
  ok((await bp.locator(".bank-tile.glow").count()) >= 5, "cada conta tem o ícone do banco com brilho");
  ok(!(await bp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "Conexões cabe na tela do celular");
  await bc.close();

  // ------------------------------------------------------------ dinheiro de/para cofrinho: só movimentação (nem gasto, nem ganho)
  const c1 = await mk(`Dinheiro reservado Cofre ${RUN}`, 200, "out", { daysAgo: 2 });
  const c2 = await mk(`Dinheiro retirado Cofre ${RUN}`, 150, "in", { daysAgo: 1 });
  const flags = async (...x) => (await admin.from("transactions").select("id, is_internal_transfer, category_source, categories(name)").in("id", x)).data;
  ok((await flags(c1, c2)).every((t) => t.is_internal_transfer && t.categories?.name === "Transferência interna"), "“Dinheiro reservado” e “Dinheiro retirado” novos já entram como movimentação interna (não contam como gasto nem como ganho)");
  const { data: acc0 } = await admin.from("accounts").select("id").eq("household_id", s.hid).limit(1).single();
  const oldRows = await admin.from("transactions").insert([
    { household_id: s.hid, account_id: acc0.id, provider_tx_id: `pm-a-${RUN}`, occurred_at: new Date().toISOString(), amount_cents: 5000, description_raw: `Dinheiro retirado Antigo ${RUN}`, description: `Dinheiro retirado Antigo ${RUN}`, category_source: "none" },
    { household_id: s.hid, account_id: acc0.id, provider_tx_id: `pm-b-${RUN}`, occurred_at: new Date().toISOString(), amount_cents: 7000, description_raw: `Dinheiro retirado Manual ${RUN}`, description: `Dinheiro retirado Manual ${RUN}`, category_source: "user" },
    { household_id: s.hid, account_id: acc0.id, provider_tx_id: `pm-c-${RUN}`, occurred_at: new Date().toISOString(), amount_cents: -4000, description_raw: `Dinheiro reservado Embutida ${RUN}`, description: `Dinheiro reservado Embutida ${RUN}`, category_source: "rule" },
    { household_id: s.hid, account_id: acc0.id, provider_tx_id: `pm-d-${RUN}`, occurred_at: new Date().toISOString(), amount_cents: -3000, description_raw: `Dinheiro reservado MinhaRegra${RUN}`, description: `Dinheiro reservado MinhaRegra${RUN}`, category_source: "rule" },
    { household_id: s.hid, account_id: acc0.id, provider_tx_id: `pm-e-${RUN}`, occurred_at: new Date().toISOString(), amount_cents: 2000, description_raw: `Pix de alguem ${RUN}`, description: `Pix de alguem ${RUN}`, category_source: "user" },
  ]).select("id, provider_tx_id");
  const [oa, ob, oc, od, oe] = oldRows.data.map((r) => r.id);
  ids.push(oa, ob, oc, od, oe);
  // uma regra da própria pessoa vence a correção; "Transferência interna" escolhida à mão sem a marca passa a ter a marca
  const { data: catInt } = await admin.from("categories").select("id").eq("household_id", s.hid).eq("slug", "interna").single();
  const { data: ruleRow } = await admin.from("rules").insert({ household_id: s.hid, name: `Minha regra ${RUN}`, source: "manual", category_id: (await admin.from("categories").select("id").eq("household_id", s.hid).eq("slug", "investimentos").maybeSingle()).data?.id ?? catInt.id, conditions: [{ field: "description", op: "contains", value: `MinhaRegra${RUN}` }] }).select("id").single();
  await admin.from("transactions").update({ category_id: catInt.id }).eq("id", oe);
  await fetch(`${BASE}/api/cron/manutencao`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  const fl = await flags(oa, ob);
  const fa = fl.find((x) => x.id === oa), fb = fl.find((x) => x.id === ob);
  ok(fa.is_internal_transfer && !fb.is_internal_transfer, "o que já estava importado é corrigido na manutenção diária, sem mexer no que você categorizou à mão");
  const fl2 = await flags(oc, od, oe);
  ok(fl2.find((x) => x.id === oc).is_internal_transfer, "palavra-chave embutida (origem “regra”) é substituída: “Dinheiro reservado” já importado vira movimentação interna");
  ok(!fl2.find((x) => x.id === od).is_internal_transfer, "mas uma regra criada por você vence e não é alterada");
  ok(fl2.find((x) => x.id === oe).is_internal_transfer, "lançamento que você pôs em “Transferência interna” sem a marca passa a ser movimentação interna");
  await admin.from("rules").delete().eq("id", ruleRow.id);

  // regra da própria pessoa que manda para "Transferência interna": vale para o que já foi importado e para o que chegar depois
  const { data: ruleInt } = await admin.from("rules").insert({ household_id: s.hid, name: `Reservado teste ${RUN}`, source: "manual", category_id: catInt.id, conditions: [{ field: "description", op: "contains", value: `Guardadinho${RUN}` }] }).select("id").single();
  const { data: oldInv } = await admin.from("transactions").insert({ household_id: s.hid, account_id: acc0.id, provider_tx_id: `pm-f-${RUN}`, occurred_at: new Date().toISOString(), amount_cents: -2500, description_raw: `Guardadinho${RUN} antigo`, description: `Guardadinho${RUN} antigo`, category_source: "rule" }).select("id").single();
  ids.push(oldInv.id);
  await fetch(`${BASE}/api/cron/manutencao`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  ok((await flags(oldInv.id))[0].is_internal_transfer, "regra sua para “Transferência interna” vale para o que já estava importado");
  const novo = await mk(`Guardadinho${RUN} novo`, 30, "out");
  ok((await flags(novo))[0].is_internal_transfer, "e para o que chegar depois (já entra como movimentação interna)");
  await admin.from("rules").delete().eq("id", ruleInt.id);

  // ------------------------------------------------------------ Metas: cofrinhos (total, por banco, vários no mesmo banco, ocultar)
  const inv = (suffix, bank, name, kind, cents) => ({ household_id: s.hid, side: "asset", category: "investimento", name, value_cents: cents, source: "pluggy", provider_id: `inv:pot-${RUN}-${suffix}`, details: { kind, issuer: bank } });
  await admin.from("holdings").insert([
    inv("a", "Banco Cofre", "Cofrinho Viagem", "Renda fixa", 100000),
    inv("b", "Banco Cofre", "Cofrinho Reserva", "Renda fixa", 250050),
    inv("c", "Outro Cofre", "Caixinha Casa", "Renda fixa", 30000),
    inv("d", "Banco Cofre", "Ações Teste", "Ações", 999900),
  ]);
  await admin.from("accounts").insert({ household_id: s.hid, provider_account_id: `acc-pot-${RUN}`, name: "Banco Cofre", type: "savings", institution: "MeuPluggy", balance_cents: 50000 });
  const cctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await cctx.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const cp = await cctx.newPage();
  await cp.goto(BASE + "/orcamentos");
  await cp.waitForLoadState("networkidle");
  const card = cp.locator(".card", { has: cp.getByRole("heading", { name: /Cofrinhos/ }) });
  ok(await until(async () => (await card.innerText()).includes("R$ 4.300,50")), "Cofrinhos mostra o total somando todos os bancos (R$ 4.300,50)");
  const t0 = await card.innerText();
  ok(t0.includes("Banco Cofre") && t0.includes("Outro Cofre"), "separa por banco");
  ok(t0.includes("Cofrinho Viagem") && t0.includes("Cofrinho Reserva") && t0.includes("Poupança"), "mostra cada cofrinho individualmente, mesmo vários no mesmo banco");
  ok(t0.includes("R$ 4.000,50"), "e o subtotal do banco que tem mais de um (R$ 4.000,50)");
  ok(!t0.includes("Ações Teste") && !t0.includes("9.999,00"), "aplicações que não são cofrinhos (ações) ficam de fora");
  await card.getByRole("button", { name: /Ocultar Cofrinho Reserva/ }).click();
  ok(await until(async () => (await card.innerText()).includes("R$ 1.800,00")), "ocultar um item tira do total (R$ 1.800,00)");
  ok((await card.innerText()).includes("Mostrar 1 oculto"), "e avisa que há 1 oculto");
  await cp.locator(".note").getByRole("button", { name: "Desfazer" }).click();
  ok(await until(async () => (await card.innerText()).includes("R$ 4.300,50")), "Desfazer devolve o item ao total");
  // cofrinhos que o banco entrega DENTRO da conta (saldos reservados do Open Finance): Mercado Pago, Nubank, Inter...
  const { data: mpAcc } = await admin.from("accounts").insert({ household_id: s.hid, provider_account_id: `acc-potmp-${RUN}`, name: "Mercado Pago (Conta Pré-paga)", type: "checking", institution: "MeuPluggy", balance_cents: 3000 }).select("id").single();
  await admin.from("account_pots").insert([
    { household_id: s.hid, account_id: mpAcc.id, provider_ref: `ref-${RUN}-1`, name: "Kellybja", value_cents: 30902 },
    { household_id: s.hid, account_id: mpAcc.id, provider_ref: `ref-${RUN}-2`, name: "Cofre", value_cents: 242036 },
    { household_id: s.hid, account_id: mpAcc.id, provider_ref: `ref-${RUN}-3`, name: "Cofrinho da virada", value_cents: 0 },
  ]);
  await cp.goto(BASE + "/orcamentos");
  await cp.waitForLoadState("networkidle");
  ok(await until(async () => (await card.innerText()).includes("R$ 7.029,88")), "cofrinhos dentro da conta do banco entram no total (R$ 4.300,50 + R$ 2.729,38 = R$ 7.029,88)");
  const tp = await card.innerText();
  ok(tp.includes("Mercado Pago") && tp.includes("Kellybja") && tp.includes("R$ 2.729,38"), "aparecem agrupados no banco, cada um com o seu nome, com o subtotal do banco");
  ok(!tp.includes("Cofrinho da virada"), "cofrinho zerado não aparece");
  await card.getByRole("button", { name: /Ocultar Cofre:/ }).click();
  ok(await until(async () => (await card.innerText()).includes("R$ 4.609,52")), "ocultar um deles tira do total (R$ 4.609,52)");
  await cp.locator(".note").getByRole("button", { name: "Desfazer" }).click();
  ok(await until(async () => (await card.innerText()).includes("R$ 7.029,88")), "Desfazer devolve ao total");
  // rendimento dos cofrinhos: lançamentos "Rendimentos" dos últimos 30 dias + taxa de cada cofrinho
  const { data: catRend } = await admin.from("categories").select("id").eq("household_id", s.hid).eq("slug", "rendimentos").single();
  await admin.from("transactions").insert([150, 200].map((v, k) => ({ household_id: s.hid, account_id: mpAcc.id, provider_tx_id: `rend-${RUN}-${k}`, occurred_at: new Date(Date.now() - (k + 1) * 864e5).toISOString(), amount_cents: v, description_raw: "Rendimentos", description: "Rendimentos", category_id: catRend.id, category_source: "provider" })));
  await admin.from("account_pots").update({ rate_pct: 119.9983 }).eq("account_id", mpAcc.id).eq("name", "Cofre");
  await cp.goto(BASE + "/orcamentos");
  await cp.waitForLoadState("networkidle");
  ok(await until(async () => (await card.innerText()).includes("Rendeu R$ 3,50 nos últimos 30 dias")), "o cartão mostra quanto os cofrinhos renderam nos últimos 30 dias (R$ 3,50)");
  ok((await card.innerText()).includes("120% do CDI"), "e a taxa de cada cofrinho (120% do CDI)");
  await admin.from("transactions").delete().like("provider_tx_id", `rend-${RUN}-%`);
  await cp.goto(BASE + "/patrimonio");
  await cp.waitForLoadState("networkidle");
  ok(await until(async () => (await cp.locator("main").innerText()).includes("Mercado Pago · Cofre")), "o dinheiro dos cofrinhos também entra no patrimônio (lista de bens e investimentos)");
  await cp.goto(BASE + "/orcamentos");
  await cp.waitForLoadState("networkidle");

  // meta ligada a cofrinhos: o progresso passa a ser o saldo deles
  const { data: goalRow } = await admin.from("goals").insert({ household_id: s.hid, name: `Meta Viagem ${RUN}`, kind: "saving", target_cents: 500000 }).select("id").single();
  await cp.goto(BASE + "/orcamentos");
  await cp.waitForLoadState("networkidle");
  const goalCard = cp.locator(".card", { hasText: `Meta Viagem ${RUN}` });
  ok(await until(async () => (await goalCard.count()) === 1), "a meta aparece em Metas");
  await goalCard.locator("details.goal-pots summary").click();
  await goalCard.getByLabel(/Banco Cofre · Cofrinho Viagem/).check();
  await goalCard.getByLabel(/Banco Cofre · Cofrinho Reserva/).check();
  await goalCard.getByRole("button", { name: "Salvar" }).last().click();
  ok(await until(async () => { const t = await goalCard.innerText(); return t.includes("R$ 3.500,50") && t.includes("70%"); }), "ligada a 2 cofrinhos, o progresso vira a soma dos saldos (R$ 3.500,50 = 70%)");
  ok((await goalCard.innerText()).includes("O progresso vem do saldo dos cofrinhos"), "e avisa que o progresso vem do cofrinho");
  ok((await goalCard.getByLabel("Valor do aporte").count()) === 0 && (await goalCard.locator("details.goal-pots summary").innerText()).includes("Ligada a 2"), "o formulário de aporte some e o resumo diz “Ligada a 2 cofrinhos”");
  // previsão: meta ligada ao Cofre usa as entradas líquidas dos últimos 3 meses (guardado − retirado) + rendimento
  await admin.from("transactions").insert([
    { household_id: s.hid, account_id: mpAcc.id, provider_tx_id: `eta-a-${RUN}`, occurred_at: new Date(Date.now() - 50 * 864e5).toISOString(), amount_cents: -60000, description_raw: "Dinheiro reservado Cofre", description: "Dinheiro reservado Cofre", is_internal_transfer: true },
    { household_id: s.hid, account_id: mpAcc.id, provider_tx_id: `eta-b-${RUN}`, occurred_at: new Date(Date.now() - 20 * 864e5).toISOString(), amount_cents: 30000, description_raw: "Dinheiro retirado Cofre", description: "Dinheiro retirado Cofre", is_internal_transfer: true },
  ]);
  await admin.from("goals").update({ pot_refs: [] }).eq("id", goalRow.id);
  const { data: cofrePot } = await admin.from("account_pots").select("id").eq("account_id", mpAcc.id).eq("name", "Cofre").single();
  await admin.from("goals").update({ pot_refs: [`pot:${cofrePot.id}`], target_cents: 500000 }).eq("id", goalRow.id);
  await cp.goto(BASE + "/orcamentos");
  await cp.waitForLoadState("networkidle");
  ok(await until(async () => /no ritmo atual: [a-zç]{3}\/\d{4}/.test(await goalCard.innerText())), "meta ligada a cofrinho mostra a previsão “no ritmo atual: mês/ano” pelas entradas líquidas dos últimos 3 meses");
  const barColor = await goalCard.locator(".bar-fill").evaluate((e) => getComputedStyle(e).backgroundColor);
  ok(barColor === "rgb(31, 195, 255)", "a barra da meta ligada ao Cofre do Mercado Pago usa a cor do banco");
  await admin.from("transactions").delete().like("provider_tx_id", `eta-%-${RUN}`);
  // meta com aportes manuais: ritmo = média dos últimos 3 meses (R$ 300/mês; faltam R$ 4.100 → 14 meses)
  const { data: goalM } = await admin.from("goals").insert({ household_id: s.hid, name: `Meta Ritmo ${RUN}`, kind: "saving", target_cents: 500000 }).select("id").single();
  const dd = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  await admin.from("goal_contributions").insert([[60, 30000], [35, 30000], [10, 30000]].map(([n, v]) => ({ household_id: s.hid, goal_id: goalM.id, amount_cents: v, at: dd(n) })));
  await cp.goto(BASE + "/orcamentos");
  await cp.waitForLoadState("networkidle");
  const eta14 = new Date(Date.UTC(Number(dd(0).slice(0, 4)), Number(dd(0).slice(5, 7)) - 1 + 14, 15));
  const etaTxt = `${eta14.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "")}/${eta14.getUTCFullYear()}`;
  ok(await until(async () => (await cp.locator(".card", { hasText: `Meta Ritmo ${RUN}` }).innerText()).includes(`no ritmo atual: ${etaTxt}`)), `meta com aportes de R$ 300/mês e faltando R$ 4.100 prevê ${etaTxt} (14 meses)`);
  await admin.from("goals").delete().eq("id", goalM.id);
  await admin.from("goals").delete().eq("id", goalRow.id);
  await cctx.close();

  const mc = await br.newContext({ viewport: { width: 360, height: 800 } });
  await mc.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const mpp = await mc.newPage();
  await mpp.goto(BASE + "/orcamentos");
  await mpp.waitForLoadState("networkidle");
  ok(!(await mpp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "Metas cabe na tela do celular com os cofrinhos");
  await mc.close();

  // ------------------------------------------------------------ Painel: "Livre para gastar"
  const pl = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await pl.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const plp = await pl.newPage();
  await plp.goto(BASE + "/");
  await plp.waitForLoadState("networkidle");
  const livre = plp.locator(".kpi", { hasText: "Livre para gastar" });
  ok(await until(async () => (await livre.count()) === 1), "o Painel mostra “Livre para gastar” no mês atual");
  const lt = await livre.innerText();
  ok(/R\$/.test(lt) && (/por dia/.test(lt) || /passam do saldo|sem folga/.test(lt)), "com o valor e a explicação (por dia, ou aviso de que contas e fatura passam do saldo)");
  await plp.goto(BASE + "/?mes=2026-01");
  await plp.waitForLoadState("networkidle");
  ok((await plp.locator(".kpi", { hasText: "Livre para gastar" }).count()) === 0, "e só aparece no mês atual (meses passados mostram o saldo no fim do mês)");
  await pl.close();

  // ------------------------------------------------------------ aviso de conexão que precisa de atenção (casa descartável, nada real é avisado)
  const memberId = (await admin.from("household_members").select("user_id").eq("household_id", s.hid).limit(1).single()).data.user_id; // (a sessão do teste já saiu no teste do botão Sair)
  const tmpHh = (await admin.from("households").insert({ uses_app_pluggy: false }).select("id").single()).data.id;
  globalThis.__tmpHh = tmpHh;
  await admin.from("push_subscriptions").insert({ household_id: tmpHh, user_id: memberId, endpoint: `https://push.example.test/alerta-${RUN}`, p256dh: "B".repeat(87), auth: "A".repeat(22) });
  const itAlert = randomUUID();
  await admin.from("connections").insert({ household_id: tmpHh, provider_item_id: itAlert, institution: `Banco Alerta ${RUN}`, status: "LOGIN_ERROR" });
  const runCron = () => fetch(`${BASE}/api/cron/manutencao`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }).then((r) => r.json());
  const alerted = async () => (await admin.from("connections").select("alerted_at").eq("provider_item_id", itAlert).single()).data.alerted_at;
  await runCron();
  const first = await alerted();
  ok(!!first, "conexão com LOGIN_ERROR e aparelho cadastrado: o aviso é disparado e registrado");
  await runCron();
  ok((await alerted()) === first, "e não repete no mesmo dia (no máximo um a cada 3 dias)");
  await admin.from("connections").update({ status: "UPDATED" }).eq("provider_item_id", itAlert);
  await runCron();
  ok((await alerted()) === null, "conexão que voltou ao normal zera o controle (o próximo problema avisa na hora)");

  // ------------------------------------------------------------ resumo do mês (notificação no dia 1)
  const prevYm = (() => { const t = new Date(); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() - 1); return t.toISOString().slice(0, 7); })();
  const { data: tmpAcc } = await admin.from("accounts").insert({ household_id: tmpHh, provider_account_id: `acc-res-${RUN}`, name: "Conta Resumo", type: "checking", institution: "Teste" }).select("id").single();
  await admin.from("transactions").insert([
    { household_id: tmpHh, account_id: tmpAcc.id, provider_tx_id: `res-a-${RUN}`, occurred_at: `${prevYm}-10T15:00:00Z`, amount_cents: 100000, description_raw: "Receita teste", description: "Receita teste", is_internal_transfer: false },
    { household_id: tmpHh, account_id: tmpAcc.id, provider_tx_id: `res-b-${RUN}`, occurred_at: `${prevYm}-12T15:00:00Z`, amount_cents: -40000, description_raw: "Despesa teste", description: "Despesa teste", is_internal_transfer: false },
    { household_id: tmpHh, account_id: tmpAcc.id, provider_tx_id: `res-c-${RUN}`, occurred_at: `${prevYm}-13T15:00:00Z`, amount_cents: -9900, description_raw: "Dinheiro reservado Cofre", description: "Dinheiro reservado Cofre", is_internal_transfer: true },
  ]);
  const rs1 = (await fetch(`${BASE}/api/cron/manutencao?forcar_resumo=${prevYm}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }).then((r) => r.json())).resumo;
  const nb = (t) => t.replace(/ /g, " ");
  const bodyRes = (rs1.bodies ?? []).map(nb).find((b) => b.includes("entrou R$ 1.000,00"));
  ok(!!bodyRes && bodyRes.includes("saiu R$ 400,00"), "o resumo do mês traz o que entrou e o que saiu (R$ 1.000,00 e R$ 400,00), sem contar movimento de cofrinho");
  const rs2 = (await fetch(`${BASE}/api/cron/manutencao?forcar_resumo=${prevYm}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }).then((r) => r.json())).resumo;
  ok(!(rs2.bodies ?? []).map(nb).some((b) => b.includes("entrou R$ 1.000,00")), "e não repete o mesmo mês para o mesmo aparelho");
  const rs3 = (await fetch(`${BASE}/api/cron/manutencao`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }).then((r) => r.json())).resumo;
  ok(new Date().getUTCDate() === 1 || rs3.skipped === "não é dia 1", "fora do dia 1 a manutenção normal não envia o resumo");

  // ------------------------------------------------------------ backup externo: protegido por segredo e cifrado
  const bk = (hdr) => fetch(`${BASE}/api/backup/export`, { headers: hdr });
  ok((await bk({})).status === 403 && (await bk({ authorization: "Bearer errado" })).status === 403, "a exportação do backup recusa chamada sem o segredo");
  const ex = await bk({ authorization: `Bearer ${process.env.BACKUP_EXPORT_SECRET}` });
  const exBuf = Buffer.from(await ex.arrayBuffer());
  ok(ex.status === 200 && exBuf.subarray(0, 5).toString() === "APGB1", "com o segredo devolve o arquivo cifrado (formato APGB1)");
  ok(!exBuf.toString("latin1").includes("transactions") && !exBuf.toString("latin1").includes(process.env.TEST_EMAIL), "o conteúdo está cifrado (não aparece texto nem e-mails)");
  const { createDecipheriv, hkdfSync } = await import("node:crypto");
  const { gunzipSync } = await import("node:zlib");
  const open = (ikm) => { const key = Buffer.from(hkdfSync("sha256", ikm, Buffer.from("apogeu-backup"), Buffer.from("v1"), 32)); const d = createDecipheriv("aes-256-gcm", key, exBuf.subarray(5, 17)); d.setAuthTag(exBuf.subarray(17, 33)); return JSON.parse(gunzipSync(Buffer.concat([d.update(exBuf.subarray(33)), d.final()])).toString()); };
  const dec = open(Buffer.from(process.env.DOC_ENC_KEY, "base64"));
  ok(dec.format === "apogeu-backup-externo" && dec.households.some((h) => h.household_id === s.hid && h.data.transactions.length > 0), "com a DOC_ENC_KEY o arquivo abre e traz as transações da casa");
  let wrong = false; try { open(Buffer.alloc(32, 7)); } catch { wrong = true; }
  ok(wrong, "com outra chave o arquivo não abre");

  // ------------------------------------------------------------ Perguntar no celular: poucos exemplos e nada passa da borda
  const pq = await br.newContext({ viewport: { width: 360, height: 800 } });
  await pq.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const pp = await pq.newPage();
  await pp.goto(BASE + "/perguntar");
  await pp.waitForLoadState("networkidle");
  ok((await pp.locator("form .chip").count()) <= 3, "Perguntar mostra no máximo 3 exemplos");
  const fora = await pp.evaluate(() => {
    const card = document.querySelector("form.card").getBoundingClientRect();
    return [...document.querySelectorAll("form.card *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > card.right + 1 || r.left < card.left - 1); }).length;
  });
  ok(fora === 0, "a caixa de busca e os exemplos ficam dentro do cartão no celular");
  await pq.close();

  // ------------------------------------------------------------ /instalar: iPhone mostra o passo a passo do Safari
  const ios = await br.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  const ip2 = await ios.newPage();
  await ip2.goto(BASE + "/instalar");
  ok(await until(async () => (await ip2.getByText("Adicionar à Tela de Início").count()) > 0), "no iPhone a página já abre no passo a passo do Safari");
  await ip2.getByRole("tab", { name: "Android" }).click();
  ok(await ip2.getByRole("link", { name: /Baixar o Apogeu/ }).isVisible(), "dá para trocar para o Android e ver o botão de baixar");
  ok(!(await ip2.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "/instalar sem rolagem lateral no celular");
  await ios.close();

  // ------------------------------------------------------------ celular: lupa abre a busca
  const m = await br.newContext({ viewport: { width: 390, height: 844 } });
  await m.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const mp = await m.newPage();
  await mp.goto(BASE + "/transacoes");
  await mp.waitForLoadState("networkidle");
  await mp.getByRole("button", { name: "Buscar (Ctrl+F)" }).click();
  ok(await until(() => mp.locator("dialog.qs").evaluate((d) => d.open)), "no celular a lupa abre a busca");
  const wide = await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  ok(!wide, "busca no celular sem rolagem lateral");
} finally {
  await br.close();
  await admin.from("transactions").delete().in("id", ids);
  await admin.from("push_subscriptions").delete().like("endpoint", `https://push.example.test/${RUN}%`);
  await admin.from("holdings").delete().like("provider_id", `inv:pot-${RUN}-%`);
  { // a manutenção diária chamada acima cria um backup semanal da casa de teste: apaga, para não bloquear o "Fazer backup agora" (limite de 10 min)
    const { data: made } = await admin.storage.from("backups").list(s.hid);
    const mine = (made ?? []).filter((x) => x.name.includes("-semanal-")).map((x) => `${s.hid}/${x.name}`);
    if (mine.length) await admin.storage.from("backups").remove(mine);
  }
  if (globalThis.__tmpHh) {
    const { data: bf } = await admin.storage.from("backups").list(globalThis.__tmpHh);
    if (bf?.length) await admin.storage.from("backups").remove(bf.map((x) => `${globalThis.__tmpHh}/${x.name}`));
    await admin.from("households").delete().eq("id", globalThis.__tmpHh);
  }
  await admin.from("accounts").delete().eq("provider_account_id", `acc-pot-${RUN}`);
  await admin.from("accounts").delete().like("provider_account_id", `acc-bank-${RUN}-%`);
  await admin.from("accounts").delete().eq("provider_account_id", `acc-potmp-${RUN}`);
  await admin.from("connections").delete().in("provider_item_id", globalThis.__bankItems ?? []);
}

// ------------------------------------------------------------ a busca do servidor exige login
const anonSearch = await fetch(BASE + "/", { method: "POST", headers: { "next-action": "x" } });
ok(anonSearch.status !== 200 || !(await anonSearch.text()).includes(`Mercado Desfaz ${RUN}`), "sem login a busca não devolve dados");

done("Novidades");
