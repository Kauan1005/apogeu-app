-- Cofrinhos (Metas): poupança e aplicações dos bancos conectados. Cada item pode ser ocultado
-- ("isto não é um cofrinho") sem sair do patrimônio. O marcador fica fora das colunas que a
-- sincronização reescreve, então sobrevive às atualizações do banco.
alter table public.accounts add column if not exists pot_hidden boolean not null default false;
alter table public.holdings add column if not exists pot_hidden boolean not null default false;
