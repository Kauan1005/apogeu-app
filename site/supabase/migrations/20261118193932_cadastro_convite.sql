-- Fluxo · cadastro com código de convite e conta Meu Pluggy própria por casa

-- ---------------------------------------------------------------- códigos de convite (conta nova, finanças separadas)
-- Só o hash do código fica guardado; o código aparece uma vez para quem gerou. Uso único, vence em 7 dias.
create table public.signup_codes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  code_hash text not null unique,
  hint text not null check (char_length(hint) = 4),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null
);
create index signup_codes_household_idx on public.signup_codes (household_id);

alter table public.signup_codes enable row level security;
-- quem é da casa vê os códigos (sem o hash, que fica fora do select do site); gravar e usar só pelo servidor
create policy "signup_codes_select" on public.signup_codes for select to authenticated
  using (household_id in (select private.my_household_ids()));
grant select (id, household_id, created_by, hint, created_at, expires_at, used_at, used_by) on public.signup_codes to authenticated;
revoke all on public.signup_codes from anon;

-- ---------------------------------------------------------------- conta Meu Pluggy por casa
-- Casas criadas pelo administrador (script) usam a conta Meu Pluggy do site; casas criadas por código usam a própria.
alter table public.households add column uses_app_pluggy boolean not null default true;

-- client_id e client_secret cifrados no servidor (AES-256-GCM). Nenhum usuário lê esta tabela: só o servidor.
create table public.pluggy_credentials (
  household_id uuid primary key references public.households (id) on delete cascade,
  client_id_enc text not null,
  client_secret_enc text not null,
  client_id_hint text not null,
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.pluggy_credentials enable row level security;
revoke all on public.pluggy_credentials from anon, authenticated;

-- sem gatilho de auditoria automática: ele copiaria o hash do código e as credenciais cifradas para o audit_log,
-- que todos da casa leem. As ações registram no audit_log só o que aconteceu, sem segredos.
