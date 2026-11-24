-- Biometria (passkey) que dispensa o código do autenticador, SÓ para quem ligou isso em Ajustes.
-- Vale quando a sessão veio de um login por passkey (amr = passkey) E a conta tem app_metadata.passkey_skips_mfa = true
-- (marca que só o servidor grava, depois de pedir o código recente e a confirmação do risco).
create or replace function private.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
      or coalesce((select auth.jwt() -> 'app_metadata' ->> 'mfa_optional'), '') = 'true'
      or (
        coalesce((select auth.jwt() -> 'app_metadata' ->> 'passkey_skips_mfa'), '') = 'true'
        and exists (
          select 1 from jsonb_array_elements(coalesce((select auth.jwt() -> 'amr'), '[]'::jsonb)) a
          where a ->> 'method' = 'passkey'
        )
      );
$$;
