-- O app_metadata do Supabase só é gravado depois do INSERT do login; o gatilho não o enxerga.
-- O cadastro com código passa o id do código reservado em user_metadata.fluxo_signup, e o banco confere
-- que esse código acabou de ser reservado (usado há menos de 5 minutos e ainda sem dono).
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
  code_id text := new.raw_user_meta_data ->> 'fluxo_signup';
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
  if code_id ~ '^[0-9a-f-]{36}$' and exists (
    select 1 from public.signup_codes c
    where c.id = code_id::uuid and c.used_at > now() - interval '5 minutes' and c.used_by is null
  ) then
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
