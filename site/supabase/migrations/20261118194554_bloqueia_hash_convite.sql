-- O Supabase dá a "authenticated" acesso total às tabelas novas (privilégios padrão do schema public).
-- Tira esse acesso de signup_codes e devolve só a leitura das colunas sem o hash do código.
revoke all on public.signup_codes from authenticated;
grant select (id, household_id, created_by, hint, created_at, expires_at, used_at, used_by) on public.signup_codes to authenticated;
-- credenciais da Pluggy: garante que nenhum papel do site tem acesso (só o servidor, com a chave secreta)
revoke all on public.pluggy_credentials from anon, authenticated;
