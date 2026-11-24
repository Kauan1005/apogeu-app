import { redirect } from "next/navigation";
import { createClient, createServiceClient, requireSession } from "@/lib/supabase/server";
import { Topbar } from "@/components/topbar";
import { Onboarding } from "./onboarding";

// Passo a passo para quem tem conta própria no Meu Pluggy: criar a conta, conectar os bancos lá,
// colar as chaves e trazer os bancos para o Fluxo. Quem usa a conta do administrador não precisa.
export default async function Comecar() {
  const s = await requireSession();
  const svc = createServiceClient();
  const db = await createClient();
  const [{ data: hh }, { data: cred }, { count }] = await Promise.all([
    svc.from("households").select("uses_app_pluggy").eq("id", s.householdId).single(),
    svc.from("pluggy_credentials").select("client_id_hint").eq("household_id", s.householdId).maybeSingle(),
    db.from("connections").select("id", { count: "exact", head: true }).eq("household_id", s.householdId).not("institution", "ilike", "%meupluggy%").not("institution", "ilike", "%meu pluggy%"),
  ]);
  if (hh?.uses_app_pluggy) redirect("/conexoes");
  return (
    <>
      <Topbar title="Conectar seus bancos" />
      <div className="content page-in">
        <Onboarding hasCreds={!!cred} credHint={cred?.client_id_hint ?? null} banks={count ?? 0} owner={s.role === "owner"} />
      </div>
    </>
  );
}
