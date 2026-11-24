-- Fluxo · endurecimento de segurança (revisão de 18/11/2026)

-- 1) Só e-mails autorizados ganham household. Um cadastro feito por fora (API pública de signup)
--    vira um usuário sem household: a RLS não devolve nada e o site recusa a sessão.
create table private.allowed_emails (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
revoke all on private.allowed_emails from public, anon, authenticated;

-- autoriza quem já existe hoje (o dono e o usuário de teste)
insert into private.allowed_emails (email)
select lower(email) from auth.users where email is not null
on conflict do nothing;

create or replace function private.bootstrap_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
begin
  if not exists (select 1 from private.allowed_emails a where a.email = lower(new.email)) then
    return new; -- sem household: nenhum acesso a dados
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

-- 2) Nenhum registro pode apontar para dados de OUTRO household (as FKs só checam o id).
--    Uso: trigger ... execute function private.same_household('tabela_referenciada', 'coluna')
create or replace function private.same_household()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ref_table text := tg_argv[0];
  col text := tg_argv[1];
  ref_id uuid := (to_jsonb(new) ->> col)::uuid;
  ok boolean;
begin
  if ref_id is null then return new; end if;
  execute format('select exists (select 1 from public.%I r where r.id = $1 and r.household_id = $2)', ref_table)
    into ok using ref_id, new.household_id;
  if not ok then
    raise exception 'referência inválida: %.% aponta para fora do household', tg_table_name, col using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.same_household() from public, anon;
grant execute on function private.same_household() to authenticated, service_role;

do $$
declare r record;
begin
  for r in select * from (values
    ('transactions', 'category_id', 'categories'),
    ('transactions', 'account_id', 'accounts'),
    ('transaction_splits', 'category_id', 'categories'),
    ('transaction_splits', 'transaction_id', 'transactions'),
    ('transaction_tags', 'tag_id', 'tags'),
    ('transaction_tags', 'transaction_id', 'transactions'),
    ('attachments', 'transaction_id', 'transactions'),
    ('payees', 'category_id', 'categories'),
    ('rules', 'category_id', 'categories'),
    ('bills', 'category_id', 'categories'),
    ('bill_occurrences', 'bill_id', 'bills'),
    ('bill_occurrences', 'matched_transaction_id', 'transactions'),
    ('budgets', 'category_id', 'categories'),
    ('goal_contributions', 'goal_id', 'goals'),
    ('categories', 'parent_id', 'categories'),
    ('accounts', 'connection_id', 'connections'),
    ('tx_embeddings', 'transaction_id', 'transactions')
  ) as t(tbl, col, ref) loop
    execute format(
      'create trigger %I before insert or update of %I on public.%I for each row execute function private.same_household(%L, %L)',
      'same_household_' || r.tbl || '_' || r.col, r.col, r.tbl, r.ref, r.col);
  end loop;
end $$;
