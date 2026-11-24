-- Contas fixas parceladas (carnê, empréstimo, compra em N vezes no boleto)
alter table public.bills drop constraint bills_recurrence_check;
alter table public.bills add constraint bills_recurrence_check check (recurrence in ('monthly', 'once', 'installments'));
alter table public.bills add column installments_total smallint check (installments_total between 2 and 120);
alter table public.bills add constraint bills_installments_total_required
  check (recurrence <> 'installments' or installments_total is not null);

-- A view ganha o número da parcela (1..N) e o total, calculados pelo mês de início.
drop view public.bill_occurrences_status;
create view public.bill_occurrences_status
with (security_invoker = true)
as
select
  o.*,
  b.name,
  b.category_id,
  b.recurrence,
  b.installments_total,
  case when b.recurrence = 'installments' then
    ((extract(year from o.due_date)::int - extract(year from b.starts_on)::int) * 12
      + extract(month from o.due_date)::int - extract(month from b.starts_on)::int + 1)
  end as installment_no,
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
