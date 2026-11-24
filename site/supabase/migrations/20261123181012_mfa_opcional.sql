-- 2FA opcional: por padrão toda sessão precisa de 2FA (aal2). A pessoa pode desligar a exigência para a própria conta em
-- Ajustes (pedindo o código do autenticador e confirmando o risco). O desligamento vive em app_metadata.mfa_optional do
-- usuário, que SÓ o servidor consegue gravar (chave de serviço) e que viaja dentro do JWT: o banco não precisa de consulta extra.
create or replace function private.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
      or coalesce((select auth.jwt() -> 'app_metadata' ->> 'mfa_optional'), '') = 'true';
$$;
revoke execute on function private.mfa_ok() from public, anon;
grant execute on function private.mfa_ok() to authenticated;

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
    and (select private.mfa_ok());
$$;

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
      and (select private.mfa_ok())
  );
$$;
