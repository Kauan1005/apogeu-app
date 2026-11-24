-- Meta ligada a cofrinhos: o progresso passa a ser o saldo dos cofrinhos escolhidos ("account:<id>" ou "holding:<id>").
alter table public.goals add column if not exists pot_refs text[] not null default '{}';

-- Aviso de conexão que precisa de atenção: guarda quando o último aviso foi enviado (no máximo um a cada 3 dias).
alter table public.connections add column if not exists alerted_at timestamptz;
