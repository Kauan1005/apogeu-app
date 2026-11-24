-- Conexões, contas e transações nunca mudam de casa depois de criadas (nem por um upsert do servidor).
-- Evita que uma sincronização de outra casa "puxe" os dados de alguém por engano.
create or replace function private.lock_household()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id is distinct from old.household_id then
    raise exception 'household_id não pode mudar (%.%)', tg_table_name, old.id using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.lock_household() from public, anon, authenticated;

create trigger lock_household_connections before update of household_id on public.connections
  for each row execute function private.lock_household();
create trigger lock_household_accounts before update of household_id on public.accounts
  for each row execute function private.lock_household();
create trigger lock_household_transactions before update of household_id on public.transactions
  for each row execute function private.lock_household();
create trigger lock_household_holdings before update of household_id on public.holdings
  for each row execute function private.lock_household();
