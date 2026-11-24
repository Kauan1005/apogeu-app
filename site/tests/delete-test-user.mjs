// Apaga o usuário de TESTE (marcado com app_metadata.test_user), a casa dele (dados fictícios, comprovantes e backups).
// Uso: node --env-file=.env.local --env-file=.env.test.local tests/delete-test-user.mjs
import { createClient } from "@supabase/supabase-js";

const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
// só a conta de teste (e-mail do .env.test.local E marcada como teste pelo create-test-user) e sobras
// de rodadas de teste que também tenham a marca; nunca uma conta real
const targets = [];
for (let page = 1; page <= 50; page++) {
  const { data } = await a.auth.admin.listUsers({ page, perPage: 200 });
  targets.push(...data.users.filter((u) => u.app_metadata?.test_user === true && (u.email === process.env.TEST_EMAIL || (u.email ?? "").endsWith("@fluxo.test"))));
  if (data.users.length < 200) break;
}
for (const u of targets) {
  const { data: m } = await a.from("household_members").select("household_id").eq("user_id", u.id);
  for (const { household_id: hid } of m ?? []) {
    const { data: others } = await a.from("household_members").select("user_id").eq("household_id", hid).neq("user_id", u.id);
    if (others?.some((o) => !targets.some((t) => t.id === o.user_id))) { console.log("casa compartilhada com uma conta real; a casa foi mantida"); continue; }
    for (const bucket of ["backups", "attachments"]) {
      const walk = async (prefix) => {
        const { data: items } = await a.storage.from(bucket).list(prefix, { limit: 1000 });
        const files = [];
        for (const it of items ?? []) { if (it.id) files.push(`${prefix}/${it.name}`); else files.push(...(await walk(`${prefix}/${it.name}`))); }
        return files;
      };
      const files = await walk(hid);
      if (files.length) await a.storage.from(bucket).remove(files);
    }
    await a.from("households").delete().eq("id", hid);
  }
  await a.auth.admin.deleteUser(u.id);
  console.log(`apagado: ${u.email.replace(/^(.{3}).*(@.*)$/, "$1***$2")}`);
}
if (!targets.length) console.log("nenhuma conta de teste encontrada");
