-- Fluxo · Ajustes: código de pagamento nas contas e categorias do usuário

-- Código para pagar: Pix copia e cola, chave Pix ou linha digitável do boleto.
-- Na conta fixa fica o código que se repete (ex.: chave Pix); na ocorrência, o do mês (ex.: boleto).
alter table public.bills add column payment_code text check (char_length(payment_code) <= 600);
alter table public.bill_occurrences add column payment_code text check (char_length(payment_code) <= 600);

-- A view lista as colunas explicitamente; recriada para incluir o código do mês ou o da conta.
drop view public.bill_occurrences_status;
create view public.bill_occurrences_status
with (security_invoker = true)
as
select
  o.*,
  b.name,
  b.category_id,
  b.recurrence,
  coalesce(o.payment_code, b.payment_code) as code,
  case
    when o.paid_at is not null then 'pago'
    when o.due_date < (now() at time zone 'America/Sao_Paulo')::date then 'atrasado'
    else 'pendente'
  end as status
from public.bill_occurrences o
join public.bills b on b.id = o.bill_id;
grant select on public.bill_occurrences_status to authenticated;
revoke all on public.bill_occurrences_status from anon;

-- Categorias criadas pelo usuário ficam marcadas; as do sistema não podem ser apagadas.
alter table public.categories add column is_system boolean not null default false;
update public.categories set is_system = true;
-- subcategoria só um nível abaixo e do mesmo household (checado na aplicação; aqui, a mesma família de tipo)
alter table public.categories add constraint categories_not_self_parent check (parent_id is null or parent_id <> id);
