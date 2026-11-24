-- Fluxo · ajustes da Fase 3: quem conectou cada banco, custo de aquisição e histórico de valores dos bens

-- ---------------------------------------------------------------- bancos por pessoa (modo casal)
alter table public.connections add column created_by uuid references auth.users (id) on delete set null;
create index connections_created_by_idx on public.connections (created_by);

-- quem conectou (ou o dono da casa) é o único que altera ou apaga a conexão
drop policy if exists "connections_update" on public.connections;
drop policy if exists "connections_delete" on public.connections;
create policy "connections_update" on public.connections for update to authenticated
  using (household_id in (select private.my_household_ids()) and (created_by = (select auth.uid()) or (select private.is_owner(household_id))))
  with check (household_id in (select private.my_household_ids()));
create policy "connections_delete" on public.connections for delete to authenticated
  using (household_id in (select private.my_household_ids()) and (created_by = (select auth.uid()) or (select private.is_owner(household_id))));

-- ---------------------------------------------------------------- custo de aquisição (o IR declara por ele)
alter table public.holdings
  add column acquisition_cents bigint check (acquisition_cents is null or acquisition_cents >= 0),
  add column acquired_on date;

-- ---------------------------------------------------------------- histórico do valor de cada bem/dívida (um por dia)
create table public.holding_values (
  holding_id uuid not null references public.holdings (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  day date not null,
  value_cents bigint not null,
  primary key (holding_id, day)
);
create index holding_values_household_idx on public.holding_values (household_id);

create or replace function private.track_holding_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.value_cents is distinct from old.value_cents then
    insert into public.holding_values (holding_id, household_id, day, value_cents)
    values (new.id, new.household_id, (now() at time zone 'America/Sao_Paulo')::date, new.value_cents)
    on conflict (holding_id, day) do update set value_cents = excluded.value_cents;
  end if;
  return new;
end;
$$;
revoke execute on function private.track_holding_value() from public, anon, authenticated;
create trigger track_holding_value after insert or update of value_cents on public.holdings
  for each row execute function private.track_holding_value();

-- histórico dos bens que já existem
insert into public.holding_values (holding_id, household_id, day, value_cents)
select id, household_id, (updated_at at time zone 'America/Sao_Paulo')::date, value_cents from public.holdings
on conflict do nothing;

alter table public.holding_values enable row level security;
create policy "holding_values_select" on public.holding_values for select to authenticated
  using (household_id in (select private.my_household_ids()));
grant select on public.holding_values to authenticated;
revoke all on public.holding_values from anon;
