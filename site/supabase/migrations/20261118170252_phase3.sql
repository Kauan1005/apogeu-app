-- Fluxo · Fase 3: patrimônio, modo casal, backups e documento cifrado

-- ---------------------------------------------------------------- patrimônio
-- Bens e dívidas fora das contas correntes: investimentos (Pluggy ou manuais), imóveis, veículos,
-- empréstimos e financiamentos. O saldo das contas e o limite usado dos cartões entram no cálculo à parte.
create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  side text not null check (side in ('asset', 'liability')),
  category text not null check (category in ('investimento', 'imovel', 'veiculo', 'outro_bem', 'financiamento', 'emprestimo', 'outra_divida')),
  name text not null check (char_length(name) between 1 and 80),
  value_cents bigint not null default 0 check (value_cents >= 0),
  source text not null default 'manual' check (source in ('manual', 'pluggy')),
  provider_id text unique,
  connection_id uuid references public.connections (id) on delete set null,
  details jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((side = 'asset') = (category in ('investimento', 'imovel', 'veiculo', 'outro_bem')))
);
create index holdings_household_idx on public.holdings (household_id, side);
create index holdings_connection_idx on public.holdings (connection_id);

-- Foto mensal do patrimônio (uma linha por mês; a do mês corrente é atualizada todo dia)
create table public.net_worth_snapshots (
  household_id uuid not null references public.households (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  assets_cents bigint not null,
  liabilities_cents bigint not null,
  breakdown jsonb not null default '{}',
  taken_at timestamptz not null default now(),
  primary key (household_id, month)
);

-- ---------------------------------------------------------------- modo casal
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null default 'member' check (role in ('member')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (household_id, email)
);
create index household_invites_email_idx on public.household_invites (email) where accepted_at is null;

-- dono do household (com 2FA)
create or replace function private.is_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid()) and m.role = 'owner'
      and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
  );
$$;
revoke execute on function private.is_owner(uuid) from public, anon;
grant execute on function private.is_owner(uuid) to authenticated;

-- Novo usuário: se tem convite pendente, entra no household de quem convidou; senão, se o e-mail
-- está autorizado, ganha household próprio; senão, fica sem acesso.
create or replace function private.bootstrap_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
  inv record;
begin
  select * into inv from public.household_invites i where i.email = lower(new.email) and i.accepted_at is null order by i.created_at desc limit 1;
  if found then
    insert into public.household_members (household_id, user_id, role) values (inv.household_id, new.id, inv.role)
      on conflict do nothing;
    update public.household_invites set accepted_at = now() where id = inv.id;
    return new;
  end if;
  if not exists (select 1 from private.allowed_emails a where a.email = lower(new.email)) then
    return new;
  end if;
  insert into public.households default values returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, new.id, 'owner');
  insert into public.categories (household_id, slug, name, kind, color, icon, sort) values
    (hid, 'moradia',       'Moradia',               'expense',  'c1',   'home',    1),
    (hid, 'alimentacao',   'Alimentação',           'expense',  'c2',   'food',    2),
    (hid, 'contas',        'Contas fixas',          'expense',  'c3',   'receipt', 3),
    (hid, 'transporte',    'Transporte',            'expense',  'c4',   'car',     4),
    (hid, 'compras',       'Compras',               'expense',  'c5',   'bag',     5),
    (hid, 'lazer',         'Lazer',                 'expense',  'c6',   'smile',   6),
    (hid, 'saude',         'Saúde',                 'expense',  null,   'health',  7),
    (hid, 'assinaturas',   'Assinaturas',           'expense',  null,   'play',    8),
    (hid, 'educacao',      'Educação',              'expense',  null,   'edu',     9),
    (hid, 'investimentos', 'Investimentos',         'expense',  null,   'trend',  10),
    (hid, 'outros',        'Outros',                'expense',  null,   'dots',   11),
    (hid, 'salario',       'Salário',               'income',   null,   'wallet', 20),
    (hid, 'rendimentos',   'Rendimentos',           'income',   null,   'trend',  21),
    (hid, 'reembolsos',    'Reembolsos',            'income',   null,   'transfer', 22),
    (hid, 'outras-entradas','Outras entradas',      'income',   null,   'dots',   23),
    (hid, 'interna',       'Transferência interna', 'transfer', null,   'transfer', 30),
    (hid, 'fatura',        'Pagamento de fatura',   'transfer', null,   'card',   31);
  update public.categories set is_system = true where household_id = hid;
  return new;
end;
$$;
revoke execute on function private.bootstrap_user() from public, anon, authenticated;

-- ---------------------------------------------------------------- documento da contraparte cifrado
-- AES-256-GCM feito no servidor (chave DOC_ENC_KEY fora do banco). Só o relatório de IR decifra.
alter table public.transactions add column counterpart_doc_enc text;

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['holdings', 'net_worth_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy "%1$s_select" on public.%1$I for select to authenticated using (household_id in (select private.my_household_ids()))$p$, t);
    execute format($p$create policy "%1$s_insert" on public.%1$I for insert to authenticated with check (household_id in (select private.my_household_ids()))$p$, t);
    execute format($p$create policy "%1$s_update" on public.%1$I for update to authenticated using (household_id in (select private.my_household_ids())) with check (household_id in (select private.my_household_ids()))$p$, t);
    execute format($p$create policy "%1$s_delete" on public.%1$I for delete to authenticated using (household_id in (select private.my_household_ids()))$p$, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- convites: todos os membros veem; só o dono cria e cancela
alter table public.household_invites enable row level security;
create policy "invites_select" on public.household_invites for select to authenticated using (household_id in (select private.my_household_ids()));
create policy "invites_insert" on public.household_invites for insert to authenticated with check ((select private.is_owner(household_id)));
create policy "invites_delete" on public.household_invites for delete to authenticated using ((select private.is_owner(household_id)));
grant select, insert, delete on public.household_invites to authenticated;
revoke all on public.household_invites from anon;

create trigger same_household_holdings_connection_id before insert or update of connection_id on public.holdings
  for each row execute function private.same_household('connections', 'connection_id');
create trigger audit_holdings after insert or update or delete on public.holdings
  for each row execute function private.audit();
create trigger audit_household_invites after insert or update or delete on public.household_invites
  for each row execute function private.audit();

-- ---------------------------------------------------------------- backups (bucket privado; só o servidor grava)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backups', 'backups', false, 52428800, array['application/gzip', 'application/json'])
on conflict (id) do nothing;
create policy "backups_read" on storage.objects for select to authenticated
  using (bucket_id = 'backups' and ((storage.foldername(name))[1])::uuid in (select private.my_household_ids()));
