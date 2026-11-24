-- Autoriza um e-mail a ganhar household. Só a chave secreta (service_role) pode chamar.
create or replace function public.allow_email(p_email text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.allowed_emails (email) values (lower(trim(p_email))) on conflict do nothing;
$$;
revoke execute on function public.allow_email(text) from public, anon, authenticated;
grant execute on function public.allow_email(text) to service_role;
