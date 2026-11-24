-- Filtros salvos das Transações ("Mercado acima de R$ 100"): cada pessoa guarda os seus e vê em qualquer aparelho.
create table public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  filter jsonb not null,
  created_at timestamptz not null default now()
);
create index saved_filters_owner_idx on public.saved_filters (household_id, user_id);

alter table public.saved_filters enable row level security;
create policy "saved_filters_select" on public.saved_filters for select to authenticated
  using (household_id in (select private.my_household_ids()) and user_id = (select auth.uid()));
create policy "saved_filters_insert" on public.saved_filters for insert to authenticated
  with check (household_id in (select private.my_household_ids()) and user_id = (select auth.uid()));
create policy "saved_filters_update" on public.saved_filters for update to authenticated
  using (household_id in (select private.my_household_ids()) and user_id = (select auth.uid()))
  with check (household_id in (select private.my_household_ids()) and user_id = (select auth.uid()));
create policy "saved_filters_delete" on public.saved_filters for delete to authenticated
  using (household_id in (select private.my_household_ids()) and user_id = (select auth.uid()));
grant select, insert, update, delete on public.saved_filters to authenticated;
revoke all on public.saved_filters from anon;
