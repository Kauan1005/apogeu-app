-- Aporte sugerido quando o salário cai: guarda o que a pessoa decidiu sobre cada entrada (guardei / agora não),
-- para a sugestão não voltar. A detecção do salário é calculada, não gravada.
create table public.savings_nudges (
  household_id uuid not null references public.households (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  status text not null check (status in ('saved', 'dismissed')),
  pct smallint check (pct between 1 and 50),
  amount_cents bigint,
  goal_id uuid references public.goals (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (household_id, transaction_id)
);
create index savings_nudges_goal_idx on public.savings_nudges (goal_id);

alter table public.savings_nudges enable row level security;
create policy "savings_nudges_select" on public.savings_nudges for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy "savings_nudges_insert" on public.savings_nudges for insert to authenticated
  with check (household_id in (select private.my_household_ids()));
create policy "savings_nudges_update" on public.savings_nudges for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));
create policy "savings_nudges_delete" on public.savings_nudges for delete to authenticated
  using (household_id in (select private.my_household_ids()));
grant select, insert, update, delete on public.savings_nudges to authenticated;
revoke all on public.savings_nudges from anon;
