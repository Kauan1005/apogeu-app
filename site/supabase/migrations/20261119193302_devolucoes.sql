-- Devoluções: um gasto e a devolução do mesmo valor, do mesmo destinatário, se anulam (como se nada tivesse saído).
-- Os dois lados ficam com is_internal_transfer = true (fora de gastos e entradas, em todas as telas e no IR) e
-- apontam um para o outro; refund_pair_id também serve para desfazer o par se o banco corrigir algum valor.
alter table public.transactions add column if not exists refund_pair_id uuid references public.transactions (id) on delete set null;
create index if not exists transactions_refund_pair_idx on public.transactions (refund_pair_id) where refund_pair_id is not null;
