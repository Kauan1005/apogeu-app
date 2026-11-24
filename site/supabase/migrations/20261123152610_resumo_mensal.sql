-- Resumo do mês (notificação no dia 1): guarda, por aparelho, qual mês já foi enviado, para não repetir.
alter table public.push_subscriptions add column if not exists last_summary_ym text;
