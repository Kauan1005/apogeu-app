// Cadastro com código de convite e conta Meu Pluggy própria por casa.
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { BASE, RUN, browser, done, http, login, ok, totp, until } from "./lib.mjs";

console.log(`\n== Cadastro com convite (${BASE}) · rodada ${RUN}`);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const s = await login();
const anon = http(null);
const NEW = `nova-${RUN}@example.com`;
const PW = `Nn${Math.random().toString(36).slice(2)}#${Date.now()}`;
const started = new Date().toISOString();

const b = await browser();
const errors = [];
const track = (p, who) => { p.on("pageerror", (e) => errors.push(`${who}: ${e.message}`)); p.on("console", (m) => m.type() === "error" && errors.push(`${who}: ${m.text()}`)); };
const owner = await b.newContext({ viewport: { width: 1440, height: 900 } });
await owner.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
const page = await owner.newPage(); track(page, "dono");
page.on("dialog", (d) => d.accept());

try {
  // ------------------------------------------------------------ tela pública
  const pub = await anon.get("/criar-conta");
  ok(pub.status === 200 && pub.text.includes("Criar conta") && pub.text.includes("Código de convite"), "a tela “Criar conta” abre sem login");
  ok((await anon.get("/login")).text.includes("Tem um código de convite? Criar conta"), "o login tem o link para criar conta");

  const guest = await b.newContext({ viewport: { width: 390, height: 844 } });
  const gp = await guest.newPage(); track(gp, "nova");
  const fill = async (code) => {
    await gp.goto(BASE + "/criar-conta");
    await gp.getByLabel("Código de convite").fill(code);
    await gp.getByLabel("E-mail").fill(NEW);
    await gp.getByLabel("Senha", { exact: true }).fill(PW);
    await gp.getByLabel("Repita a senha").fill(PW);
    await gp.getByRole("button", { name: "Criar conta" }).click();
  };
  await fill("ABCD-EFGH-JKLM");
  ok(await until(async () => (await gp.locator(".err").innerText().catch(() => "")).includes("Código de convite inválido"), 8000), "código inventado é recusado");
  ok(!(await admin.auth.admin.listUsers({ perPage: 200 })).data.users.some((u) => u.email === NEW), "sem código válido, nenhuma conta é criada");

  // ------------------------------------------------------------ dono gera o código
  await page.goto(BASE + "/ajustes#acesso");
  await page.getByRole("button", { name: "Gerar código de convite" }).click();
  const box = page.getByLabel("Código de convite gerado");
  ok(await until(async () => (await box.count()) > 0, 10000), "o dono gera um código de convite em Ajustes");
  const code = await box.inputValue();
  ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), "o código tem 12 caracteres fáceis de ler");
  const { data: stored } = await admin.from("signup_codes").select("code_hash, hint").eq("household_id", s.hid).gte("created_at", started);
  ok(stored.length === 1 && !stored[0].code_hash.includes(code.replace(/-/g, "")) && stored[0].hint === code.slice(-4), "o banco guarda só o hash do código (e os 4 últimos caracteres)");
  const { error: hashErr } = await s.db.from("signup_codes").select("code_hash").eq("household_id", s.hid);
  ok(!!hashErr, "nem o dono consegue ler o hash pelo site (coluna bloqueada)");

  // ------------------------------------------------------------ pessoa nova cria a conta
  await fill(code.toLowerCase());
  ok(await until(async () => gp.url().includes("/mfa") && (await gp.locator("span.mono").count()) > 0, 15000), "com o código, a conta é criada e segue para o cadastro do 2FA");
  ok((await (await guest.request.get(BASE + "/transacoes", { maxRedirects: 0 })).status()) === 307, "sem 2FA a conta nova não vê nada");
  const secret = (await gp.locator("span.mono").innerText()).trim();
  let in2fa = false;
  for (let i = 0; i < 3 && !in2fa; i++) {
    await gp.getByLabel("Código").fill(totp(secret));
    in2fa = await until(async () => new URL(gp.url()).pathname === "/comecar", 8000);
  }
  ok(in2fa, "depois do 2FA a pessoa cai no passo a passo do Meu Pluggy (/comecar)");
  const onb = () => gp.locator("main").innerText();
  ok(await until(async () => (await onb()).includes("Crie sua conta grátis no Meu Pluggy")) && (await gp.locator('a[href="https://meu.pluggy.ai"]').count()) >= 1, "passo 1: link para criar a conta no Meu Pluggy");
  await gp.getByRole("button", { name: "Já criei a conta" }).click();
  ok(await until(async () => (await onb()).includes("A autorização acontece no app do próprio banco")), "passo 2: explica como conectar os bancos no Meu Pluggy");
  await gp.getByRole("button", { name: "Já conectei meus bancos" }).click();
  ok(await until(async () => (await onb()).includes("Pluggy Dashboard") && (await gp.getByLabel("client_id").count()) === 1), "passo 3: mostra onde pegar as chaves e o formulário");
  ok((await gp.locator(".dash-hint").count()) === 1, "passo 3: ilustração de onde clicar no painel da Pluggy");
  // colar as duas chaves de uma vez num campo: o Fluxo separa e confere sozinho (sem clicar em salvar)
  await gp.getByLabel("client_id").focus();
  await gp.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "Client ID 11111111-2222-4333-8444-555555555555" + String.fromCharCode(10) + "Client Secret 66666666-7777-4888-9999-aaaaaaaaaaaa");
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  ok(await until(async () => (await gp.getByLabel("client_id").inputValue()) === "11111111-2222-4333-8444-555555555555"), "colar as duas chaves juntas separa o Client ID");
  ok(await until(async () => (await onb()).includes("A Pluggy não aceitou essas credenciais"), 20000), "passo 3: com as duas coladas, confere sozinho na Pluggy (chaves falsas recusadas)");
  await gp.reload();
  const okBars = await until(async () => (await gp.locator(".onb-progress span.ok").count()) === 2, 5000);
  ok(okBars && (await gp.locator(".onb-step.open .onb-title").innerText()) === "Cole suas chaves da Pluggy", `o passo a passo lembra os passos já feitos ao recarregar (${await gp.locator(".onb-progress span.ok").count()} feitos)`);
  if (process.env.SHOTS) { // capturas do passo a passo (SHOTS=pasta)
    await gp.screenshot({ path: `${process.env.SHOTS}/comecar-390.png`, fullPage: true });
    await gp.setViewportSize({ width: 1440, height: 900 });
    await gp.screenshot({ path: `${process.env.SHOTS}/comecar-1440.png`, fullPage: true });
    await gp.setViewportSize({ width: 390, height: 844 });
  }
  const syncNoCreds = await guest.request.post(BASE + "/api/pluggy/sync", { data: { itemId: "00000000-0000-4000-8000-000000000000" } });
  ok(syncNoCreds.status() === 409, "sem chaves, não dá para trazer bancos (409)");
  await gp.goto(BASE + "/");
  const users = (await admin.auth.admin.listUsers({ perPage: 200 })).data.users;
  const nu = users.find((u) => u.email === NEW);
  const { data: nm } = await admin.from("household_members").select("household_id, role").eq("user_id", nu.id).single();
  ok(nm && nm.household_id !== s.hid && nm.role === "owner", "a conta nova ganha uma casa própria, separada (ela é a dona)");
  const { data: nh } = await admin.from("households").select("uses_app_pluggy").eq("id", nm.household_id).single();
  ok(nh.uses_app_pluggy === false, "a casa nova não usa a conta Meu Pluggy do administrador");
  const { data: cats } = await admin.from("categories").select("id").eq("household_id", nm.household_id);
  ok(cats.length >= 17, "a casa nova já vem com as categorias padrão");
  const { data: usedCode } = await admin.from("signup_codes").select("used_at, used_by").eq("household_id", s.hid).gte("created_at", started).single();
  ok(!!usedCode.used_at && usedCode.used_by === nu.id, "o código fica marcado como usado por essa conta");

  // os dados da casa do dono não aparecem para a conta nova (RLS)
  const gjar = new Map((await guest.cookies()).map((c) => [c.name, c.value]));
  const gdb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => [...gjar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => gjar.set(name, value)) },
  });
  const { data: leak } = await gdb.from("transactions").select("id").eq("household_id", s.hid).limit(1);
  ok((leak ?? []).length === 0, "a conta nova não enxerga nenhuma transação da casa do dono");
  const { data: credLeak, error: credErr } = await gdb.from("pluggy_credentials").select("*");
  ok(!!credErr || (credLeak ?? []).length === 0, "ninguém lê a tabela de credenciais da Pluggy pelo site");

  // ------------------------------------------------------------ conta Meu Pluggy própria
  await gp.goto(BASE + "/conexoes");
  ok(await until(async () => (await gp.locator("main").innerText()).includes("Falta a sua conta Meu Pluggy")), "Conexões avisa que falta cadastrar a conta Meu Pluggy");
  const ct = await guest.request.post(BASE + "/api/pluggy/connect-token", { data: {} });
  ok(ct.status() === 409, "sem a conta Meu Pluggy dela, não abre a conexão com banco");
  await gp.goto(BASE + "/ajustes#acesso");
  ok((await gp.locator("#acesso").innerText()).includes("Ainda não configurada"), "Ajustes mostra que a conta Meu Pluggy ainda não foi configurada");
  await gp.getByLabel("client_id").fill("00000000-0000-4000-8000-000000000000");
  await gp.getByLabel("client_secret").fill("segredo-falso-que-nao-existe-123456");
  await gp.getByRole("button", { name: "Salvar e conferir" }).click();
  ok(await until(async () => (await gp.locator("#acesso").innerText()).includes("A Pluggy não aceitou essas credenciais"), 20000), "credenciais falsas são conferidas na Pluggy e recusadas");
  await gp.getByLabel("client_id").fill(process.env.PLUGGY_CLIENT_ID);
  await gp.getByLabel("client_secret").fill("qualquer-coisa-para-testar-1234567");
  await gp.getByRole("button", { name: "Salvar e conferir" }).click();
  ok(await until(async () => (await gp.locator("#acesso").innerText()).includes("Essa é a conta Meu Pluggy do administrador"), 10000), "não deixa usar a conta Meu Pluggy do administrador");
  ok(!(await admin.from("pluggy_credentials").select("household_id").eq("household_id", nm.household_id).maybeSingle()).data, "nada foi salvo com credenciais recusadas");

  // ------------------------------------------------------------ uso único
  const again = await b.newContext();
  const ap = await again.newPage();
  await ap.goto(BASE + "/criar-conta");
  await ap.getByLabel("Código de convite").fill(code);
  await ap.getByLabel("E-mail").fill(`outra-${RUN}@example.com`);
  await ap.getByLabel("Senha", { exact: true }).fill(PW);
  await ap.getByLabel("Repita a senha").fill(PW);
  await ap.getByRole("button", { name: "Criar conta" }).click();
  ok(await until(async () => (await ap.locator(".err").innerText().catch(() => "")).includes("já usado"), 8000), "o mesmo código não cria uma segunda conta");
  await again.close();

  await page.reload();
  ok((await page.locator("#acesso").innerText()).includes("usado em"), "o dono vê que o código foi usado");
  await guest.close();
  ok(!errors.length, `console sem erros${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
} finally {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data.users.filter((x) => x.email === NEW || x.email === `outra-${RUN}@example.com`)) {
    const { data: m } = await admin.from("household_members").select("household_id").eq("user_id", u.id);
    for (const x of m ?? []) if (x.household_id !== s.hid) await admin.from("households").delete().eq("id", x.household_id);
    await admin.auth.admin.deleteUser(u.id);
  }
  await admin.from("signup_codes").delete().eq("household_id", s.hid).gte("created_at", started);
  await b.close();
}
done("Cadastro com convite");
