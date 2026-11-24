// Fluxo principal pela API e pelas páginas (sem navegador): login, Pix → categoria → tabela/painel,
// aprendizado, idempotência, contas fixas, exportação e RLS.
import { BASE, RUN, done, http, login, ok } from "./lib.mjs";
import { adminDb } from "./lib.mjs";

console.log(`\n== API e páginas (${BASE}) · rodada ${RUN}`);
const anon = http(null);
ok((await anon.get("/")).loc?.includes("/login"), "sem login, / redireciona para /login");
{ const hc = await anon.get("/api/health"); ok(hc.status === 200 && hc.text.replace(/s/g, "") === '{"ok":true}', "o monitor de saúde responde {ok:true} sem login e sem nenhum dado"); }
ok((await anon.post("/api/dev/simulate-pix", { name: "x", amount: 1 })).status === 401, "sem login, a API responde 401");

const half = await login({ mfa: false });
ok((await http(half).get("/")).loc?.includes("/mfa"), "só com senha, / pede o 2FA");

const s = await login();
const h = http(s);
// CPF fictício novo a cada rodada (o destinatário ainda não foi “aprendido”)
const CPF = String(Date.now()).slice(-11).padStart(11, "7");
// nome sem sentido e novo a cada rodada: nada parecido no histórico, então é mesmo “ambíguo”
const AMB = Array.from({ length: 3 }, () => Math.random().toString(36).slice(2, 7).replace(/\d/g, "x")).join(" ").toUpperCase();
const cats = Object.fromEntries((await s.db.from("categories").select("id, slug").eq("household_id", s.hid)).data.map((c) => [c.slug, c.id]));
const sim = (b) => h.post("/api/dev/simulate-pix", b).then((r) => r.json.transaction);

// Pix entra e é categorizado
const uber = await sim({ name: `Uber Trip ${RUN}`, amount: 23.9 });
ok(uber?.categories?.name === "Transporte" && uber.status === "ok", `Pix “Uber” → ${uber?.categories?.name} (${uber?.confidence})`);
const amb = await sim({ name: AMB, amount: 78, cpf: CPF });
ok(amb?.status === "review", `Pix ambíguo → revisar (${amb?.confidence})`);
const t = (await h.get("/transacoes")).text;
ok(t.includes(`Uber Trip ${RUN}`) && t.includes(AMB), "os Pix aparecem na tabela");
ok((await h.get("/")).text.includes("Para onde foi o dinheiro"), "o painel abre com o resumo simples (para onde foi o dinheiro)");
ok((await h.get("/?detalhes=1")).text.includes("Gastos por categoria"), "“Ver gráficos e detalhes” mostra a versão completa");
ok((await h.get("/revisar")).text.includes(AMB), "o ambíguo está na fila Revisar");

// aprendizado: destinatário lembrado (mesmo CPF) → próximo Pix já categorizado
const { data: row } = await s.db.from("transactions").select("payee_key").eq("id", amb.id).single();
await s.db.from("payees").upsert({ household_id: s.hid, key: row.payee_key, category_id: cats.moradia, display_name: AMB }, { onConflict: "household_id,key" });
const again = await sim({ name: AMB, amount: 900, cpf: CPF });
ok(again?.categories?.name === "Moradia" && again.category_source === "payee", "mesmo CPF de novo → Moradia pelo destinatário aprendido");

// idempotência
const { data: dup } = await s.db.from("transactions").select("account_id, provider_tx_id").eq("id", amb.id).single();
const { error: dupErr } = await s.db.from("transactions").insert({ household_id: s.hid, account_id: dup.account_id, provider_tx_id: dup.provider_tx_id, occurred_at: new Date().toISOString(), amount_cents: -1, description_raw: "x", description: "x" });
ok(!!dupErr, "transação repetida (mesmo id do banco) é recusada");

// contas fixas: pendente, atrasada, pago/em aberto, conciliação pelo extrato, parcelas
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const dd = Number(today.slice(8, 10)), first = today.slice(0, 8) + "01";
const names = { late: `Atrasada ${RUN}`, open: `Pendente ${RUN}`, rec: `Energia ${RUN}`, inst: `Carne ${RUN}` };
if (dd > 1) {
  // em lote, toda linha leva todos os campos (o PostgREST preenche os ausentes com null)
  const bill = (name, amount_cents, due_day, extra = {}) => ({ household_id: s.hid, name, amount_cents, due_day, starts_on: first, recurrence: "monthly", installments_total: null, match_keyword: null, ...extra });
  const { error: billErr } = await s.db.from("bills").insert([
    bill(names.late, 10000, dd - 1),
    bill(names.open, 10000, Math.min(28, dd + 3)),
    bill(names.rec, 31337, Math.min(28, dd + 2), { match_keyword: `energia ${RUN}` }),
    bill(names.inst, 25000, 28, { recurrence: "installments", installments_total: 3 }),
  ]);
  ok(!billErr, "contas de teste criadas" + (billErr ? `: ${billErr.message}` : ""));
  await h.get("/contas");
  const occ = async (n) => (await s.db.from("bill_occurrences_status").select("id, status, paid_source, installment_no").eq("household_id", s.hid).eq("name", n).single()).data;
  ok((await occ(names.late))?.status === "atrasado", "venceu sem pagamento → atrasada (automático)");
  ok((await occ(names.open))?.status === "pendente", "a vencer → pendente (automático)");
  const o = await occ(names.late);
  if (!o) throw new Error("ocorrência não gerada");
  await s.db.from("bill_occurrences").update({ paid_at: new Date().toISOString(), paid_source: "manual" }).eq("id", o.id);
  ok((await occ(names.late)).status === "pago", "marcar como pago → pago");
  await s.db.from("bill_occurrences").update({ paid_at: null, paid_source: null }).eq("id", o.id);
  ok((await occ(names.late)).status === "atrasado", "voltar para em aberto → atrasada de novo");
  await sim({ name: `Energia ${RUN} Distribuidora`, amount: 313.37 });
  const r = await occ(names.rec);
  ok(r?.status === "pago" && r.paid_source === "auto", "pagamento no extrato concilia a conta sozinho");
  ok((await occ(names.inst))?.installment_no === 1, "conta parcelada: parcela 1 de 3 no mês atual");
  await s.db.from("bills").delete().like("name", `%${RUN}%`).eq("household_id", s.hid);
} else console.log("SKIP  contas fixas (dia 1 do mês)");

// aviso de consentimento no painel (conexões fictícias, apagadas em seguida)
const day = (n) => new Date(Date.now() + n * 864e5).toISOString();
const fake = [`00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`, `00000000-0000-4000-9000-${String(Date.now()).slice(-12)}`];
await (await adminDb()).from("connections").insert([
  { household_id: s.hid, provider_item_id: fake[0], institution: `Banco Vencendo ${RUN}`, status: "UPDATED", consent_expires_at: day(5) },
  { household_id: s.hid, provider_item_id: fake[1], institution: `Banco Vencido ${RUN}`, status: "UPDATED", consent_expires_at: day(-2) },
]);
const painel = (await h.get("/")).text;
ok(painel.includes(`Consentimento de Banco Vencendo ${RUN} vence em 5 dias`), "painel avisa: consentimento vence em 5 dias");
ok(painel.includes(`Consentimento de Banco Vencido ${RUN} venceu`), "painel avisa: consentimento vencido");
ok(painel.includes("Renovar em Conexões"), "o aviso leva para renovar em Conexões");
await (await adminDb()).from("connections").delete().in("provider_item_id", fake);

// exportação e RLS
const csv = await fetch(BASE + "/api/export?format=csv", { headers: { cookie: s.cookie() } });
ok(csv.status === 200 && (await csv.text()).includes(`Uber Trip ${RUN}`), "exportação CSV contém as transações");
const all = await fetch(BASE + "/api/export/all", { headers: { cookie: s.cookie() } });
ok(all.status === 200 && Array.isArray((await all.json()).transactions), "exportar todos os dados (JSON)");
const leak = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/transactions?select=id&limit=1`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } });
ok(leak.status === 401 || leak.status === 403, "sem login o banco recusa ler transações");

// limpeza: transações desta rodada (e os embeddings delas, em cascata) — não “ensinam” a próxima rodada
await (await adminDb()).from("transactions").delete().eq("household_id", s.hid).or(`description.ilike.%${RUN}%,description.eq.${AMB}`);
done("API e páginas");
