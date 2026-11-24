-- Ao excluir a conta (household em cascata), a auditoria não deve tentar gravar
-- registros apontando para um household que está sendo apagado.
create or replace function private.audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  hid uuid := (r ->> 'household_id')::uuid;
begin
  if hid is not null and not exists (select 1 from public.households h where h.id = hid) then
    return coalesce(new, old);
  end if;
  insert into public.audit_log (household_id, actor, table_name, row_id, action, diff)
  values (
    hid,
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
