// Aporte sugerido quando o salário cai: detecção, efeito na data da meta, registrar, dispensar e isolamento.
import { BASE, RUN, adminDb, browser, done, login, ok, until } from "./lib.mjs";

console.log(`\n== Aporte sugerido (${BASE}) · rodada ${RUN}`);
const admin = await adminDb();
const s = await login();
const br = await browser();
let accId = null, goalId = null;
const txIds = [];
try {
  const { data: cats } = await admin.from("categories").select("id, slug").eq("household_id", s.hid);
  const salario = cats.find((c) => c.slug === "salario").id;
  accId = (await admin.from("accounts").insert({ household_id: s.hid, provider_account_id: `acc-apo-${RUN}`, name: "Conta Aporte", type: "checking", institution: "Teste", balance_cents: 800000 }).select("id").single()).data.id;
  goalId = (await admin.from("goals").insert({ household_id: s.hid, name: `Meta Aporte ${RUN}`, kind: "saving", target_cents: 1200000 }).select("id").single()).data.id;
  await admin.from("goal_contributions").insert({ goal_id: goalId, household_id: s.hid, amount_cents: 100000, note: "base", at: new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10) });
  const tx = async (n, cents, daysAgo, desc, cat = salario) => {
    const r = await admin.from("transactions").insert({ household_id: s.hid, account_id: accId, provider_tx_id: `apo-${n}-${RUN}`, occurred_at: new Date(Date.now() - daysAgo * 864e5).toISOString(), amount_cents: cents, description_raw: desc, description: desc, category_id: cat, category_source: "user", is_internal_transfer: false, status: "ok" }).select("id").single();
    txIds.push(r.data.id);
    return r.data.id;
  };

  // renda pequena não é salário: sem sugestão
  await tx("peq", 20000, 1, `Reembolso Pequeno ${RUN}`, null);
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...s.jar].map(([name, value]) => ({ name, value, url: BASE })));
  const p = await ctx.newPage();
  const card = p.locator('[aria-label="Aporte sugerido"]');
  const abrir = async () => { await p.goto(BASE + "/"); await p.waitForLoadState("networkidle"); };
  await abrir();
  ok((await card.count()) === 0, "uma entrada pequena (R$ 200) não gera sugestão");

  // salário de R$ 5.000 entrou ontem
  const t1 = await tx("sal1", 500000, 1, `Salario Empresa ${RUN}`);
  await abrir();
  ok(await until(async () => (await card.count()) === 1), "quando o salário cai, o Painel sugere guardar uma parte");
  const txt = async () => (await card.innerText()).replace(/ /g, " ");
  ok((await txt()).includes("R$ 500,00") && (await txt()).includes("5.000,00"), "a sugestão começa em 10% (R$ 500,00) e cita a entrada (R$ 5.000,00)");
  const sel = card.locator("select");
  if (await sel.count()) await sel.selectOption({ label: `Meta Aporte ${RUN}` });
  const efeito = card.getByTestId("effect");
  const e10 = (await efeito.innerText()).replace(/ /g, " ");
  ok(e10.includes(`Meta Aporte ${RUN}`) && /chega em [a-zç]{3}\/\d{4}/.test(e10) && /hoje: [a-zç]{3}\/\d{4}/.test(e10), "mostra quando a meta chega guardando isso todo mês, ao lado de “hoje”");
  await card.getByRole("radio", { name: "20%" }).click();
  ok((await txt()).includes("R$ 1.000,00"), "trocar para 20% recalcula o valor (R$ 1.000,00)");
  const e20 = (await efeito.innerText()).replace(/ /g, " ");
  const ym = (x) => x.match(/chega em ([a-zç]{3}\/\d{4})/)?.[1];
  const ordem = (m) => { const [mm, yy] = m.split("/"); return Number(yy) * 12 + ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"].indexOf(mm); };
  ok(ym(e10) && ym(e20) && ordem(ym(e20)) < ordem(ym(e10)), "guardar mais antecipa a data da meta");

  await card.getByRole("button", { name: /Registrar R\$ 1\.000,00/ }).click();
  ok(await until(async () => ((await admin.from("goal_contributions").select("amount_cents, note").eq("goal_id", goalId).eq("note", "Aporte do salário")).data ?? []).some((c) => Number(c.amount_cents) === 100000)), "registrar grava o aporte na meta com o valor recalculado no servidor (20% de R$ 5.000)");
  const n1 = (await admin.from("savings_nudges").select("status, pct, amount_cents, goal_id").eq("household_id", s.hid).eq("transaction_id", t1).single()).data;
  ok(n1?.status === "saved" && n1.pct === 20 && Number(n1.amount_cents) === 100000 && n1.goal_id === goalId, "a decisão fica guardada (guardei, 20%, valor e meta)");
  ok(await until(async () => (await card.count()) === 0), "depois de registrar, a sugestão some");

  // outro salário: "agora não" não mexe na meta e some para sempre
  const t2 = await tx("sal2", 480000, 0, `Adiantamento ${RUN}`);
  await abrir();
  ok(await until(async () => (await card.count()) === 1), "uma nova entrada grande gera nova sugestão");
  await card.getByRole("button", { name: "Agora não" }).click();
  ok(await until(async () => (await admin.from("savings_nudges").select("status").eq("household_id", s.hid).eq("transaction_id", t2).maybeSingle()).data?.status === "dismissed"), "“Agora não” fica guardado");
  const aportes = (await admin.from("goal_contributions").select("id").eq("goal_id", goalId).eq("note", "Aporte do salário")).data ?? [];
  ok(aportes.length === 1, "e não registra nenhum aporte");
  await abrir();
  ok((await card.count()) === 0, "a sugestão dispensada não volta");

  // isolamento: sem 2FA o banco não entrega as decisões
  const half = await login({ mfa: false });
  ok(((await half.db.from("savings_nudges").select("transaction_id")).data ?? []).length === 0, "só com a senha (sem 2FA) o banco não entrega nada");
  await ctx.close();
} finally {
  await br.close();
  await admin.from("savings_nudges").delete().eq("household_id", s.hid).in("transaction_id", txIds);
  await admin.from("transactions").delete().like("provider_tx_id", `apo-%-${RUN}`);
  if (goalId) await admin.from("goals").delete().eq("id", goalId);
  if (accId) await admin.from("accounts").delete().eq("id", accId);
}
done("Aporte sugerido");
