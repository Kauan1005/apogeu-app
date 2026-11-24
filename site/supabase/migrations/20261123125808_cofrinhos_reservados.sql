-- Cofrinhos que o banco entrega dentro da conta (Open Finance "saldos reservados"): Mercado Pago, Nubank, Inter...
-- A sincronização grava um registro por cofrinho; "hidden" é do usuário ("isto não é um cofrinho") e sobrevive às atualizações.
create table public.account_pots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  provider_ref text not null,
  name text not null check (char_length(name) between 1 and 80),
  value_cents bigint not null default 0 check (value_cents >= 0),
  rate_pct numeric,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (account_id, provider_ref)
);
create index account_pots_household_idx on public.account_pots (household_id);

alter table public.account_pots enable row level security;
create policy "pots_select" on public.account_pots for select to authenticated using (household_id in (select private.my_household_ids()));
create policy "pots_update" on public.account_pots for update to authenticated
  using (household_id in (select private.my_household_ids())) with check (household_id in (select private.my_household_ids()));

-- só o servidor grava os valores; a pessoa só pode ler e ocultar/mostrar
revoke all on public.account_pots from anon, authenticated;
grant select on public.account_pots to authenticated;
grant update (hidden) on public.account_pots to authenticated;
