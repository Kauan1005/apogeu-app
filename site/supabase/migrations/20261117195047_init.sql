-- Fluxo · schema inicial
-- Valores monetários em centavos (bigint). Datas em timestamptz. Chaves uuid.
-- RLS em todas as tabelas expostas; acesso só para membros do household com 2FA (aal2).

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------- households
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Minhas finanças',
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_id_idx on public.household_members (user_id);

-- Households do usuário atual. Só devolve algo com sessão 2FA (aal2).
create or replace function private.my_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hm.household_id
  from public.household_members hm
  where hm.user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;
revoke execute on function private.my_household_ids() from public, anon;
grant execute on function private.my_household_ids() to authenticated;

-- ---------------------------------------------------------------- categorias
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  parent_id uuid references public.categories (id) on delete set null,
  slug text not null,
  name text not null,
  kind text not null check (kind in ('expense', 'income', 'transfer')),
  color text,
  icon text,
  sort smallint not null default 0,
  unique (household_id, slug)
);
create index categories_parent_id_idx on public.categories (parent_id);

-- ---------------------------------------------------------------- conexões e contas
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  provider text not null default 'pluggy',
  provider_item_id text not null unique,
  institution text,
  status text not null default 'updating',
  error text,
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index connections_household_id_idx on public.connections (household_id);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  connection_id uuid references public.connections (id) on delete set null,
  provider_account_id text unique,
  name text not null,
  type text not null default 'checking' check (type in ('checking', 'savings', 'credit', 'other')),
  institution text,
  number_masked text,
  balance_cents bigint not null default 0,
  credit_limit_cents bigint,
  closing_day smallint check (closing_day between 1 and 31),
  due_day smallint check (due_day between 1 and 31),
  currency text not null default 'BRL',
  updated_at timestamptz not null default now()
);
create index accounts_household_id_idx on public.accounts (household_id);
create index accounts_connection_id_idx on public.accounts (connection_id);

-- ---------------------------------------------------------------- destinatários conhecidos e regras
create table public.payees (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  key text not null,               -- hash do documento ou descrição normalizada
  display_name text,
  category_id uuid references public.categories (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (household_id, key)
);
create index payees_category_id_idx on public.payees (category_id);

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  -- [{"field":"description","op":"contains","value":"uber"}]
  conditions jsonb not null,
  category_id uuid not null references public.categories (id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'auto', 'suggested')),
  active boolean not null default true,
  hits integer not null default 0,
  created_at timestamptz not null default now()
);
create index rules_household_active_idx on public.rules (household_id) where active;
create index rules_category_id_idx on public.rules (category_id);

-- ---------------------------------------------------------------- transações
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  provider_tx_id text not null,
  occurred_at timestamptz not null,
  has_time boolean not null default false,
  amount_cents bigint not null,                 -- negativo = saída
  original_amount_cents bigint,                 -- valor antes de cancelamento/alteração
  description_raw text not null,
  description text not null,
  counterpart_name text,
  counterpart_doc_hash text,
  counterpart_doc_masked text,
  payee_key text,                               -- chave do destinatário (documento em hash ou descrição normalizada)
  payment_method text,
  provider_category text,
  category_id uuid references public.categories (id) on delete set null,
  category_source text not null default 'none'
    check (category_source in ('rule', 'payee', 'provider', 'similarity', 'user', 'transfer', 'none')),
  confidence real,
  status text not null default 'ok' check (status in ('ok', 'review', 'canceled')),
  is_internal_transfer boolean not null default false,
  notes text,
  purchase_date date,
  installment_number smallint,
  total_installments smallint,
  provider_bill_id text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider_tx_id)          -- idempotência da importação
);
create index transactions_household_occurred_idx on public.transactions (household_id, occurred_at desc) where deleted_at is null;
create index transactions_review_idx on public.transactions (household_id, occurred_at desc) where status = 'review' and deleted_at is null;
create index transactions_trash_idx on public.transactions (household_id, deleted_at) where deleted_at is not null;
create index transactions_category_id_idx on public.transactions (category_id);
create index transactions_payee_key_idx on public.transactions (household_id, payee_key) where payee_key is not null;
create index transactions_description_trgm_idx on public.transactions using gin (description extensions.gin_trgm_ops);

create table public.transaction_versions (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  changed_at timestamptz not null default now(),
  previous jsonb not null
);
create index transaction_versions_tx_idx on public.transaction_versions (transaction_id);
create index transaction_versions_household_idx on public.transaction_versions (household_id);

create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  amount_cents bigint not null,
  note text
);
create index transaction_splits_tx_idx on public.transaction_splits (transaction_id);
create index transaction_splits_household_idx on public.transaction_splits (household_id);
create index transaction_splits_category_idx on public.transaction_splits (category_id);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  unique (household_id, name)
);

create table public.transaction_tags (
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  primary key (transaction_id, tag_id)
);
create index transaction_tags_tag_idx on public.transaction_tags (tag_id);
create index transaction_tags_household_idx on public.transaction_tags (household_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  storage_path text not null,
  filename text not null,
  created_at timestamptz not null default now()
);
create index attachments_tx_idx on public.attachments (transaction_id);
create index attachments_household_idx on public.attachments (household_id);

-- Embeddings gte-small (384 dimensões) para a camada de semelhança
create table public.tx_embeddings (
  transaction_id uuid primary key references public.transactions (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  embedding extensions.vector(384) not null
);
create index tx_embeddings_household_idx on public.tx_embeddings (household_id);
create index tx_embeddings_hnsw_idx on public.tx_embeddings using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------- contas a pagar
create table public.bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  amount_cents bigint not null check (amount_cents > 0),
  due_day smallint not null check (due_day between 1 and 31),
  recurrence text not null default 'monthly' check (recurrence in ('monthly', 'once')),
  starts_on date not null default current_date,
  category_id uuid references public.categories (id) on delete set null,
  match_keyword text,              -- texto que identifica o pagamento no extrato
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index bills_household_idx on public.bills (household_id);
create index bills_category_idx on public.bills (category_id);

create table public.bill_occurrences (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  due_date date not null,
  amount_cents bigint not null,
  paid_at timestamptz,             -- null = em aberto
  paid_source text check (paid_source in ('manual', 'auto')),
  matched_transaction_id uuid references public.transactions (id) on delete set null,
  unique (bill_id, due_date)
);
create index bill_occurrences_household_due_idx on public.bill_occurrences (household_id, due_date);
create index bill_occurrences_open_idx on public.bill_occurrences (household_id, due_date) where paid_at is null;
create index bill_occurrences_tx_idx on public.bill_occurrences (matched_transaction_id);

-- Status sempre calculado: pago, atrasado (venceu sem pagamento) ou pendente.
create view public.bill_occurrences_status
with (security_invoker = true)
as
select
  o.*,
  b.name,
  b.category_id,
  b.recurrence,
  case
    when o.paid_at is not null then 'pago'
    when o.due_date < (now() at time zone 'America/Sao_Paulo')::date then 'atrasado'
    else 'pendente'
  end as status
from public.bill_occurrences o
join public.bills b on b.id = o.bill_id;

-- ---------------------------------------------------------------- webhooks e auditoria
create table public.webhook_events (
  event_id text primary key,       -- idempotência: o mesmo evento nunca é processado duas vezes
  event text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  household_id uuid references public.households (id) on delete cascade,
  actor uuid,
  table_name text not null,
  row_id uuid,
  action text not null,
  at timestamptz not null default now(),
  diff jsonb
);
create index audit_log_household_at_idx on public.audit_log (household_id, at desc);

create or replace function private.audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (household_id, actor, table_name, row_id, action, diff)
  values (
    (r ->> 'household_id')::uuid,
    (select auth.uid()),
    tg_table_name,
    (r ->> 'id')::uuid,
    lower(tg_op),
    case when tg_op = 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)) else r end
  );
  return coalesce(new, old);
end;
$$;
revoke execute on function private.audit() from public, anon, authenticated;

create trigger audit_transactions after update or delete on public.transactions
  for each row execute function private.audit();
create trigger audit_rules after insert or update or delete on public.rules
  for each row execute function private.audit();
create trigger audit_bills after insert or update or delete on public.bills
  for each row execute function private.audit();
create trigger audit_bill_occurrences after update on public.bill_occurrences
  for each row execute function private.audit();
create trigger audit_connections after insert or update or delete on public.connections
  for each row execute function private.audit();

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
create trigger transactions_touch before update on public.transactions
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array[
    'categories','connections','accounts','payees','rules','transactions','transaction_versions',
    'transaction_splits','tags','transaction_tags','attachments','tx_embeddings','bills','bill_occurrences'
  ] loop
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

alter table public.households enable row level security;
create policy "households_select" on public.households for select to authenticated
  using (id in (select private.my_household_ids()));
create policy "households_update" on public.households for update to authenticated
  using (id in (select private.my_household_ids())) with check (id in (select private.my_household_ids()));
grant select, update on public.households to authenticated;
revoke all on public.households from anon;

alter table public.household_members enable row level security;
create policy "household_members_select" on public.household_members for select to authenticated
  using (household_id in (select private.my_household_ids()));
grant select on public.household_members to authenticated;
revoke all on public.household_members from anon;

-- Só o servidor (service role) lê webhooks; auditoria é somente leitura para o dono.
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
alter table public.audit_log enable row level security;
create policy "audit_log_select" on public.audit_log for select to authenticated
  using (household_id in (select private.my_household_ids()));
grant select on public.audit_log to authenticated;
revoke all on public.audit_log from anon;

grant select on public.bill_occurrences_status to authenticated;
revoke all on public.bill_occurrences_status from anon;

-- ---------------------------------------------------------------- funções de semelhança (RLS aplicada: security invoker)
create or replace function public.similar_by_text(q text, hid uuid, lim int default 5)
returns table (transaction_id uuid, description text, category_id uuid, score real)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.description, t.category_id, extensions.similarity(t.description, q) as score
  from public.transactions t
  where t.household_id = hid
    and t.category_id is not null
    and t.status = 'ok'
    and t.category_source in ('user', 'rule', 'payee')
    and t.deleted_at is null
    and t.description operator(extensions.%) q
  order by score desc
  limit lim;
$$;
grant execute on function public.similar_by_text(text, uuid, int) to authenticated, service_role;
revoke execute on function public.similar_by_text(text, uuid, int) from anon;

create or replace function public.similar_by_embedding(q extensions.vector(384), hid uuid, lim int default 5)
returns table (transaction_id uuid, description text, category_id uuid, score real)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id, t.description, t.category_id, (1 - (e.embedding operator(extensions.<=>) q))::real as score
  from public.tx_embeddings e
  join public.transactions t on t.id = e.transaction_id
  where e.household_id = hid
    and t.category_id is not null
    and t.category_source in ('user', 'rule', 'payee')
    and t.deleted_at is null
  order by e.embedding operator(extensions.<=>) q
  limit lim;
$$;
grant execute on function public.similar_by_embedding(extensions.vector, uuid, int) to authenticated, service_role;
revoke execute on function public.similar_by_embedding(extensions.vector, uuid, int) from anon;

-- ---------------------------------------------------------------- novo usuário: household + categorias padrão
create or replace function private.bootstrap_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
begin
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
  return new;
end;
$$;
revoke execute on function private.bootstrap_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.bootstrap_user();

-- ---------------------------------------------------------------- Storage: comprovantes (bucket privado, pasta = household)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy "attachments_read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and ((storage.foldername(name))[1])::uuid in (select private.my_household_ids()));
create policy "attachments_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and ((storage.foldername(name))[1])::uuid in (select private.my_household_ids()));
create policy "attachments_update" on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and ((storage.foldername(name))[1])::uuid in (select private.my_household_ids()))
  with check (bucket_id = 'attachments' and ((storage.foldername(name))[1])::uuid in (select private.my_household_ids()));
create policy "attachments_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and ((storage.foldername(name))[1])::uuid in (select private.my_household_ids()));

-- Esvazia a lixeira: transações excluídas há mais de 30 dias (agendado com pg_cron, se habilitado)
create or replace function private.purge_trash()
returns void language sql security definer set search_path = '' as $$
  delete from public.transactions where deleted_at < now() - interval '30 days';
$$;
revoke execute on function private.purge_trash() from public, anon, authenticated;
