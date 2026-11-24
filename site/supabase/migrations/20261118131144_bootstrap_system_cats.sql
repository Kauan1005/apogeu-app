-- Categorias padrão de novos usuários nascem marcadas como do sistema (não podem ser apagadas)
create or replace function private.bootstrap_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
begin
  insert into public.households default values returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, new.id, 'owner');
  insert into public.categories (household_id, slug, name, kind, color, icon, sort) values
    (hid, 'moradia',       'Moradia',               'expense',  'c1',   'home',    1),
    (hid, 'alimentacao',   'Alimentação',           'expense',  'c2',   'food',    2),
    (hid, 'contas',        'Contas fixas',          'expense',  'c3',   'receipt', 3),
    (hid, 'transporte',    'Transporte',            'expense',  'c4',   'car',     4),
    (hid, 'compras',       'Compras',               'expense',  'c5',   'bag',     5),
    (hid, 'lazer',         'Lazer',                 'expense',  'c6',   'smile',   6),
    (hid, 'saude',         'Saúde',                 'expense',  null,   'health',  7),
    (hid, 'assinaturas',   'Assinaturas',           'expense',  null,   'play',    8),
    (hid, 'educacao',      'Educação',              'expense',  null,   'edu',     9),
    (hid, 'investimentos', 'Investimentos',         'expense',  null,   'trend',  10),
    (hid, 'outros',        'Outros',                'expense',  null,   'dots',   11),
    (hid, 'salario',       'Salário',               'income',   null,   'wallet', 20),
    (hid, 'rendimentos',   'Rendimentos',           'income',   null,   'trend',  21),
    (hid, 'reembolsos',    'Reembolsos',            'income',   null,   'transfer', 22),
    (hid, 'outras-entradas','Outras entradas',      'income',   null,   'dots',   23),
    (hid, 'interna',       'Transferência interna', 'transfer', null,   'transfer', 30),
    (hid, 'fatura',        'Pagamento de fatura',   'transfer', null,   'card',   31);
  update public.categories set is_system = true where household_id = hid;
  return new;
end;
$$;
revoke execute on function private.bootstrap_user() from public, anon, authenticated;
