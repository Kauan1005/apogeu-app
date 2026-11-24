-- Avisos no celular (Web Push): cada aparelho que ativar guarda aqui o endereço de entrega.
-- Só a própria pessoa vê, cria e apaga as suas; o envio é feito pelo servidor (cron diário).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  created_at timestamptz not null default now(),
  last_sent_on date
);
create index push_subscriptions_household_idx on public.push_subscriptions (household_id);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy "push_select" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "push_insert" on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and household_id in (select private.my_household_ids()));
create policy "push_delete" on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from anon, authenticated;
grant select (id, endpoint, created_at) on public.push_subscriptions to authenticated;
grant insert (household_id, endpoint, p256dh, auth) on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;
