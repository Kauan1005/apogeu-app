-- Fluxo · Fase 2: orçamentos, metas e recorrências

-- Limite mensal por categoria (vale para todos os meses). Alerta ao chegar em `alert_pct`.
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  limit_cents bigint not null check (limit_cents > 0),
  alert_pct smallint not null default 80 check (alert_pct between 50 and 100),
  created_at timestamptz not null default now(),
  unique (household_id, category_id)
);
create index budgets_category_idx on public.budgets (category_id);

-- Metas de economia. A reserva de emergência é uma meta do tipo 'emergency',
-- cujo alvo pode ser calculado em meses de gasto médio.
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  kind text not null default 'saving' check (kind in ('saving', 'emergency')),
  target_cents bigint check (target_cents > 0),
  target_months smallint check (target_months between 1 and 24),
  deadline date,
  created_at timestamptz not null default now(),
  check (target_cents is not null or (kind = 'emergency' and target_months is not null))
);
create index goals_household_idx on public.goals (household_id);

create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  amount_cents bigint not null check (amount_cents <> 0),   -- negativo = resgate
  note text,
  at date not null default current_date,
  created_at timestamptz not null default now()
);
create index goal_contributions_goal_idx on public.goal_contributions (goal_id);
create index goal_contributions_household_idx on public.goal_contributions (household_id);

-- O que o usuário decidiu sobre uma cobrança recorrente detectada (a detecção é calculada).
create table public.recurring_flags (
  household_id uuid not null references public.households (id) on delete cascade,
  key text not null,
  status text not null check (status in ('confirmed', 'ignored')),
  updated_at timestamptz not null default now(),
  primary key (household_id, key)
);

do $$
declare t text;
begin
  foreach t in array array['budgets', 'goals', 'goal_contributions', 'recurring_flags'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy "%1$s_select" on public.%1$I for select to authenticated
      using (household_id in (select private.my_household_ids()))$p$, t);
    execute format($p$create policy "%1$s_insert" on public.%1$I for insert to authenticated
      with check (household_id in (select private.my_household_ids()))$p$, t);
    execute format($p$create policy "%1$s_update" on public.%1$I for update to authenticated
      using (household_id in (select private.my_household_ids()))
      with check (household_id in (select private.my_household_ids()))$p$, t);
    execute format($p$create policy "%1$s_delete" on public.%1$I for delete to authenticated
      using (household_id in (select private.my_household_ids()))$p$, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

create trigger audit_budgets after insert or update or delete on public.budgets
  for each row execute function private.audit();
create trigger audit_goals after insert or update or delete on public.goals
  for each row execute function private.audit();

-- Ping diário (GitHub Actions) para o projeto grátis não pausar por inatividade. Não lê nenhum dado.
create or replace function public.ping()
returns text language sql stable security invoker set search_path = '' as $$ select 'ok'::text $$;
grant execute on function public.ping() to anon, authenticated;
