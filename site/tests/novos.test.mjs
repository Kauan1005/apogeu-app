// Logos dos bancos, Revisar deslizando, filtros salvos nas Transações e Perguntar por voz.
import { BASE, RUN, adminDb, browser, done, login, ok, until } from "./lib.mjs";

console.log(`\n== Logos, deslizar, filtros salvos e voz (${BASE}) · rodada ${RUN}`);
const admin = await adminDb();
const s = await login();
const br = await browser();
const accIds = [];
try {
  const { data: cats } = await admin.from("categories").select("id, slug").eq("household_id", s.hid);
  const alim = cats.find((c) => c.slug === "alimentacao").id;
  const now = Date.now();

  // ------------------------------------------------------------ logos dos bancos
  for (const f of ["inter", "bb", "c6", "caixa"]) {
    const r = await fetch(`${BASE}/icons/${f}.png`);
    ok(r.status === 200 && (r.headers.get("content-type") ?? "").includes("image/png"), `o logo ${f}.png é servido`);
  }
  const banks = [["Banco Inter", "inter"], ["Banco do Brasil", "bb"], ["C6 Bank", "c6"], ["Caixa Econômica", "caixa"]];
  for (const [i, [inst]] of banks.entries()) {
    const id = (await admin.from("accounts").insert({ household_id: s.hid, provider_account_id: `acc-nov-${i}-${RUN}`, name: `${inst} Conta`, type: "checking", institution: inst, balance_cents: 1000 }).select("id").single()).data.id;
    accIds.push(id);
    await admin.from("transactions").insert({ household_id: s.hid, account_id: id, provider_tx_id: `nov-bk-${i}-${RUN}`, occurred_at: new Date(now - 3600e3).toISOString(), amount_cents: -1000 - i, description_raw: `Logo ${inst} ${RUN}`, description: `Logo ${inst} ${RUN}`, category_id: alim, category_source: "user", is_internal_transfer: false, status: "ok" });
  }
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const p = await ctx.newPage();
  await p.goto(BASE + "/transacoes");
  await p.waitForLoadState("networkidle");
  for (const [inst, f] of banks) {
    const row = p.locator("tbody tr", { hasText: `Logo ${inst} ${RUN}` }).first();
    ok(await until(async () => (await row.locator(`img[src="/icons/${f}.png"]`).count()) === 1), `${inst}: a transação mostra o logo do banco`);
  }
  ok(await p.evaluate(() => [...document.querySelectorAll('img[src$=".png"]')].every((i) => i.naturalWidth > 0)), "e as imagens carregam");

  // ------------------------------------------------------------ Revisar: deslizar no toque
  const mk = (n, desc, minAgo) => ({ household_id: s.hid, account_id: accIds[0], provider_tx_id: `nov-rv-${n}-${RUN}`, occurred_at: new Date(now - minAgo * 60e3).toISOString(), amount_cents: -4200 - n, description_raw: desc, description: desc, category_id: alim, category_source: "similarity", confidence: 0.5, is_internal_transfer: false, status: "review" });
  const ins = await admin.from("transactions").insert([mk(1, `Swipe Um ${RUN}`, 1), mk(2, `Swipe Dois ${RUN}`, 2)]);
  ok(!ins.error, "itens de revisão de teste criados" + (ins.error ? ": " + ins.error.message : ""));
  const mob = await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await mob.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const m = await mob.newPage();
  await m.goto(BASE + "/revisar");
  await m.waitForLoadState("networkidle");
  const card = m.getByTestId("review-card");
  const swipe = (dx, type = "touch") => m.evaluate(({ dx, type }) => {
    const el = document.querySelector('[data-testid="review-card"]');
    const r = el.getBoundingClientRect(), x0 = r.left + 40, y0 = r.top + 40;
    const ev = (t, x, y = y0) => el.dispatchEvent(new PointerEvent(t, { pointerType: type, pointerId: 7, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
    ev("pointerdown", x0);
    for (let k = 1; k <= 8; k++) ev("pointermove", x0 + (dx * k) / 8);
    ev("pointerup", x0 + dx);
  }, { dx, type });
  const shown = async () => (await card.innerText()).split("\n").find((l) => l.includes(`${RUN}`) && /Swipe/.test(l)) ?? "";
  ok(await until(async () => !!(await shown())), "o Revisar mostra o primeiro item da fila");
  const first = await shown();
  ok((await m.locator(".swipe-hint").isVisible()), "no celular, a dica de deslizar aparece");

  await swipe(60); // curto demais: volta sem fazer nada
  await m.waitForTimeout(500);
  ok((await shown()) === first && (await admin.from("transactions").select("status").like("provider_tx_id", `nov-rv-%-${RUN}`).eq("status", "review")).data.length === 2, "um deslize curto não faz nada");
  await swipe(200, "mouse"); // mouse não desliza
  await m.waitForTimeout(500);
  ok((await shown()) === first, "o mouse não desliza (só o toque)");

  await swipe(-220); // esquerda: pula
  ok(await until(async () => (await shown()) !== "" && (await shown()) !== first), "deslizar para a esquerda pula para o próximo");
  ok((await admin.from("transactions").select("status").like("provider_tx_id", `nov-rv-%-${RUN}`).eq("status", "review")).data.length === 2, "e não decide nada");
  const second = await shown();
  await swipe(220); // direita: confirma a sugestão
  ok(await until(async () => { const { data } = await admin.from("transactions").select("status, category_id, description").like("provider_tx_id", `nov-rv-%-${RUN}`).eq("status", "ok"); return data.length === 1 && second.includes(data[0].description) && data[0].category_id === alim; }, 15000), "deslizar para a direita confirma a sugestão do item que estava na tela");
  await mob.close();

  // ------------------------------------------------------------ filtros salvos
  const t = (n, desc, cents) => ({ household_id: s.hid, account_id: accIds[1], provider_tx_id: `nov-fl-${n}-${RUN}`, occurred_at: new Date(now - n * 3600e3).toISOString(), amount_cents: cents, description_raw: desc, description: desc, category_id: alim, category_source: "user", is_internal_transfer: false, status: "ok" });
  await admin.from("transactions").insert([t(1, `Mercado Filtro A ${RUN}`, -25000), t(2, `Mercado Filtro B ${RUN}`, -3000), t(3, `Padaria Filtro ${RUN}`, -40000)]);
  await p.goto(BASE + "/transacoes");
  await p.waitForLoadState("networkidle");
  const rows = (sub) => p.locator("tbody tr", { hasText: `${sub} ${RUN}` });
  ok(await until(async () => (await rows("Mercado Filtro B").count()) === 1), "as transações do teste aparecem");
  await p.locator(".toolbar").getByLabel("Buscar").fill("Mercado Filtro");
  await p.getByLabel("Valor mínimo").fill("100");
  ok(await until(async () => (await rows("Mercado Filtro A").count()) === 1 && (await rows("Mercado Filtro B").count()) === 0 && (await rows("Padaria Filtro").count()) === 0), "buscar “Mercado Filtro” acima de R$ 100 deixa só a compra de R$ 250");
  await p.getByRole("button", { name: "Salvar este filtro" }).click();
  const nome = p.getByLabel("Nome do filtro");
  ok((await nome.inputValue()).includes("Mercado Filtro") && (await nome.inputValue()).includes("acima de"), "o nome já vem sugerido a partir do filtro");
  await nome.fill(`Mercado grande ${RUN}`);
  await p.getByRole("button", { name: "Salvar", exact: true }).click();
  const chip = p.locator(".chip.saved", { hasText: `Mercado grande ${RUN}` });
  ok(await until(async () => (await chip.count()) === 1), "o filtro vira um atalho");
  const row = (await admin.from("saved_filters").select("filter, user_id, name").eq("household_id", s.hid).eq("name", `Mercado grande ${RUN}`).single()).data;
  ok(row.filter.min === 100 && row.filter.q === "Mercado Filtro" && row.user_id === (await s.db.auth.getUser()).data.user.id, "fica guardado no banco com o valor mínimo, a busca e o dono");
  ok(await chip.getByRole("button", { name: `Mercado grande ${RUN}`, exact: true }).getAttribute("aria-pressed") === "true", "o atalho aparece marcado enquanto o filtro está igual");

  await p.reload();
  await p.waitForLoadState("networkidle");
  const chip2 = p.locator(".chip.saved", { hasText: `Mercado grande ${RUN}` });
  ok(await until(async () => (await chip2.count()) === 1) && (await p.locator(".toolbar").getByLabel("Buscar").inputValue()) === "", "depois de recarregar, o atalho continua lá e a tela volta limpa");
  await chip2.getByRole("button", { name: `Mercado grande ${RUN}`, exact: true }).click();
  ok(await until(async () => (await p.locator(".toolbar").getByLabel("Buscar").inputValue()) === "Mercado Filtro" && (await p.getByLabel("Valor mínimo").inputValue()) === "100"), "tocar no atalho refaz a busca e o valor mínimo");
  ok(await until(async () => (await rows("Mercado Filtro A").count()) === 1 && (await rows("Mercado Filtro B").count()) === 0), "e a lista fica filtrada de novo");

  // só com a senha (sem 2FA) o banco não entrega nada; outra pessoa não vê os meus
  const half = await login({ mfa: false });
  ok(((await half.db.from("saved_filters").select("id")).data ?? []).length === 0, "só com a senha (sem 2FA) o banco não entrega os filtros");
  await chip2.getByRole("button", { name: `Excluir o filtro Mercado grande ${RUN}` }).click();
  ok(await until(async () => ((await admin.from("saved_filters").select("id").eq("household_id", s.hid).eq("name", `Mercado grande ${RUN}`)).data ?? []).length === 0), "excluir o atalho apaga o filtro");
  await ctx.close();

  // ------------------------------------------------------------ Perguntar por voz
  const vc = await br.newContext({ viewport: { width: 390, height: 844 } });
  await vc.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  await vc.addInitScript(() => {
    // reconhecimento de fala falso: "ouve" a frase combinada (ou dá o erro pedido) assim que começa
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() {
        const mode = sessionStorage.getItem("fake-voice");
        setTimeout(() => {
          if (mode === "denied") { this.onerror?.({ error: "not-allowed" }); this.onend?.(); return; }
          const r = [[{ transcript: "quanto gastei com lazer" }]]; r[0].isFinal = true;
          this.onresult?.({ results: r }); this.onend?.();
        }, 150);
      }
      stop() { this.onend?.(); }
    };
  });
  const v = await vc.newPage();
  await v.goto(BASE + "/perguntar");
  await v.waitForLoadState("networkidle");
  ok(await until(async () => (await v.getByRole("button", { name: "Perguntar por voz" }).count()) === 1), "o botão de microfone aparece onde o navegador sabe ouvir");
  ok((await v.locator("main").innerText()).includes("reconhecimento de voz do navegador"), "com o aviso de privacidade sobre onde o áudio é processado");
  await v.getByRole("button", { name: "Perguntar por voz" }).click();
  ok(await until(async () => new URL(v.url()).searchParams.get("q") === "quanto gastei com lazer", 10000), "falar preenche o campo e já faz a pergunta");
  ok(await until(async () => (await v.locator("main").innerText()).includes("Entendi:")), "e a resposta aparece");
  await v.evaluate(() => sessionStorage.setItem("fake-voice", "denied"));
  await v.getByRole("button", { name: "Perguntar por voz" }).click();
  ok(await until(async () => (await v.locator(".voice-status").innerText().catch(() => "")).includes("Permita o microfone")), "sem permissão do microfone, explica o que fazer");
  const nv = await vc.newPage();
  await nv.addInitScript(() => { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; });
  await nv.goto(BASE + "/perguntar");
  await nv.waitForLoadState("networkidle");
  ok((await nv.getByRole("button", { name: "Perguntar por voz" }).count()) === 0 && !(await nv.locator("main").innerText()).includes("reconhecimento de voz"), "sem suporte do navegador, nem o botão nem o aviso aparecem");
  const pp = (await fetch(BASE + "/login")).headers.get("permissions-policy") ?? "";
  ok(/microphone=\(self\)/.test(pp) && /camera=\(\)/.test(pp), "só o próprio site pode pedir o microfone (câmera e localização seguem bloqueadas)");
  await vc.close();
} finally {
  await br.close();
  await admin.from("transactions").delete().like("provider_tx_id", `nov-%-${RUN}`);
  await admin.from("saved_filters").delete().eq("household_id", s.hid).like("name", `%${RUN}`);
  for (const id of accIds) await admin.from("accounts").delete().eq("id", id);
}
done("Logos, deslizar, filtros salvos e voz");
