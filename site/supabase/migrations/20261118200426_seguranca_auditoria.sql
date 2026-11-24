-- Fluxo · correções da auditoria de segurança (2026-11-18)

-- ---------------------------------------------------------------- H1: ninguém troca a conta Meu Pluggy da casa pelo site
-- Antes: "authenticated" podia atualizar qualquer coluna de households (inclusive uses_app_pluggy).
revoke update on public.households from authenticated;
grant update (name) on public.households to authenticated;
drop policy if exists "households_update" on public.households;
create policy "households_update" on public.households for update to authenticated
  using ((select private.is_owner(id))) with check ((select private.is_owner(id)));
-- casa nova não usa a conta do administrador, a não ser que ele a crie pelo script
alter table public.households alter column uses_app_pluggy set default false;

-- ---------------------------------------------------------------- H2: convites só pelo servidor e só pelo link do convite
revoke insert, delete, update on public.household_invites from authenticated;
drop policy if exists "invites_insert" on public.household_invites;
drop policy if exists "invites_delete" on public.household_invites;

create or replace function private.seed_household(hid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (household_id, slug, name, kind, color, icon, sort, is_system) values
    (hid, 'moradia',       'Moradia',               'expense',  'c1',   'home',    1, true),
    (hid, 'alimentacao',   'Alimentação',           'expense',  'c2',   'food',    2, true),
    (hid, 'contas',        'Contas fixas',          'expense',  'c3',   'receipt', 3, true),
    (hid, 'transporte',    'Transporte',            'expense',  'c4',   'car',     4, true),
    (hid, 'compras',       'Compras',               'expense',  'c5',   'bag',     5, true),
    (hid, 'lazer',         'Lazer',                 'expense',  'c6',   'smile',   6, true),
    (hid, 'saude',         'Saúde',                 'expense',  null,   'health',  7, true),
    (hid, 'assinaturas',   'Assinaturas',           'expense',  null,   'play',    8, true),
    (hid, 'educacao',      'Educação',              'expense',  null,   'edu',     9, true),
    (hid, 'investimentos', 'Investimentos',         'expense',  null,   'trend',  10, true),
    (hid, 'outros',        'Outros',                'expense',  null,   'dots',   11, true),
    (hid, 'salario',       'Salário',               'income',   null,   'wallet', 20, true),
    (hid, 'rendimentos',   'Rendimentos',           'income',   null,   'trend',  21, true),
    (hid, 'reembolsos',    'Reembolsos',            'income',   null,   'transfer', 22, true),
    (hid, 'outras-entradas','Outras entradas',      'income',   null,   'dots',   23, true),
    (hid, 'interna',       'Transferência interna', 'transfer', null,   'transfer', 30, true),
    (hid, 'fatura',        'Pagamento de fatura',   'transfer', null,   'card',   31, true);
$$;
revoke execute on function private.seed_household(uuid) from public, anon, authenticated;

-- Quem ganha o quê ao ser criado (só o servidor cria logins; o cadastro público do Supabase está fechado):
--  * link de convite do modo casal: user_metadata.fluxo_invite = id do convite, que precisa bater com o e-mail
--  * cadastro com código: app_metadata.fluxo_via = 'code' → casa nova com a própria conta Meu Pluggy
--  * script do administrador (allowed_emails) → casa nova com a conta Meu Pluggy do site
--  Convites "plantados" para um e-mail não capturam mais ninguém: só valem pelo link.
create or replace function private.bootstrap_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
  inv record;
  inv_id text := new.raw_user_meta_data ->> 'fluxo_invite';
begin
  if inv_id ~ '^[0-9a-f-]{36}$' then
    select * into inv from public.household_invites i
      where i.id = inv_id::uuid and i.email = lower(new.email) and i.accepted_at is null;
    if found then
      insert into public.household_members (household_id, user_id, role) values (inv.household_id, new.id, inv.role)
        on conflict do nothing;
      update public.household_invites set accepted_at = now() where id = inv.id;
    end if;
    return new;
  end if;
  if coalesce(new.raw_app_meta_data ->> 'fluxo_via', '') = 'code' then
    insert into public.households (uses_app_pluggy) values (false) returning id into hid;
  elsif exists (select 1 from private.allowed_emails a where a.email = lower(new.email)) then
    insert into public.households (uses_app_pluggy) values (true) returning id into hid;
  else
    return new;
  end if;
  insert into public.household_members (household_id, user_id, role) values (hid, new.id, 'owner');
  perform private.seed_household(hid);
  return new;
end;
$$;
revoke execute on function private.bootstrap_user() from public, anon, authenticated;

-- ---------------------------------------------------------------- M1/M3: apagar histórico e criar conexões só pelo servidor
-- O site usa lixeira (deleted_at) para transações; apagar de vez só o servidor (lixeira de 30 dias, exclusão de conta).
revoke delete on public.transactions from authenticated;
revoke delete on public.accounts from authenticated;
-- conexões com bancos só nascem pela sincronização do servidor
revoke insert on public.connections from authenticated;

-- ---------------------------------------------------------------- M2: comprovante sempre dentro da pasta da própria casa
alter table public.attachments add constraint attachments_path_in_household
  check (split_part(storage_path, '/', 1) = household_id::text and position('..' in storage_path) = 0);

-- ---------------------------------------------------------------- L1: backups só por link assinado do servidor (com 2FA recente)
drop policy if exists "backups_read" on storage.objects;
