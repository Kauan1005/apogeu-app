import { Suspense } from "react";
import { createClient, requireSession } from "@/lib/supabase/server";
import { IdleLock, Sidebar } from "@/components/shell";
import { NoteHost } from "@/components/notify";
import { QuickSearch } from "@/components/quick-search";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const s = await requireSession();
  const db = await createClient();
  const [{ count: review }, { data: conns }] = await Promise.all([
    db.from("transactions").select("id", { count: "exact", head: true }).eq("household_id", s.householdId).eq("status", "review").is("deleted_at", null),
    db.from("connections").select("last_synced_at, institution").eq("household_id", s.householdId).order("last_synced_at", { ascending: false, nullsFirst: false }),
  ]);
  return (
    <div className="app">
      <Suspense>
        <Sidebar review={review ?? 0} lastSync={conns?.[0]?.last_synced_at ?? null} connections={(conns ?? []).filter((c) => !/meu ?pluggy/i.test(c.institution ?? "")).length} />
      </Suspense>
      <main className="main">{children}</main>
      <IdleLock minutes={120} />
      <QuickSearch />
      <NoteHost />
    </div>
  );
}
