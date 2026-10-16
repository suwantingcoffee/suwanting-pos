begin;
create table public.units (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  code text not null, name text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id), unique (organization_id, code)
);
create table public.categories (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id), unique (organization_id, name)
);
create table public.products (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  category_id uuid, name text not null check (length(trim(name)) > 0), description text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, category_id) references public.categories(organization_id, id)
);
create table public.product_variants (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  product_id uuid not null, unit_id uuid not null, sku text not null, name text not null,
  price numeric(18,2) not null check (price >= 0), track_inventory boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id), unique (organization_id, sku),
  foreign key (organization_id, product_id) references public.products(organization_id, id),
  foreign key (organization_id, unit_id) references public.units(organization_id, id)
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  name text not null, phone text, email text, address text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id)
);
create table public.inventory_balances (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, variant_id uuid not null, quantity numeric(18,4) not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, outlet_id, variant_id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, supplier_id uuid not null, number text not null,
  status text not null default 'draft' check (status in ('draft','approved','received','cancelled')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, outlet_id, id), unique (organization_id, number),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, supplier_id) references public.suppliers(organization_id, id)
);
create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, purchase_order_id uuid not null, variant_id uuid not null,
  quantity numeric(18,4) not null check (quantity > 0), unit_cost numeric(18,2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, outlet_id, purchase_order_id, id),
  foreign key (organization_id, outlet_id, purchase_order_id) references public.purchase_orders(organization_id, outlet_id, id),
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, purchase_order_id uuid not null, received_by uuid not null references public.profiles(id),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, outlet_id, id),
  unique (organization_id, outlet_id, purchase_order_id, id), unique (organization_id, purchase_order_id),
  foreign key (organization_id, outlet_id, purchase_order_id) references public.purchase_orders(organization_id, outlet_id, id)
);
create table public.goods_receipt_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, goods_receipt_id uuid not null, purchase_order_id uuid not null, purchase_order_item_id uuid not null,
  quantity numeric(18,4) not null check (quantity > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (goods_receipt_id, purchase_order_item_id),
  foreign key (organization_id, outlet_id, purchase_order_id, goods_receipt_id)
    references public.goods_receipts(organization_id, outlet_id, purchase_order_id, id),
  foreign key (organization_id, outlet_id, purchase_order_id, purchase_order_item_id)
    references public.purchase_order_items(organization_id, outlet_id, purchase_order_id, id)
);
create table public.recipes (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  output_variant_id uuid not null, name text not null, yield_quantity numeric(18,4) not null check (yield_quantity > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, output_variant_id) references public.product_variants(organization_id, id)
);
create table public.recipe_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  recipe_id uuid not null, variant_id uuid not null, quantity numeric(18,4) not null check (quantity > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (recipe_id, variant_id),
  foreign key (organization_id, recipe_id) references public.recipes(organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create table public.production_batches (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, recipe_id uuid not null, quantity numeric(18,4) not null check (quantity > 0),
  produced_by uuid not null references public.profiles(id), produced_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, outlet_id, id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, recipe_id) references public.recipes(organization_id, id)
);
create table public.production_inputs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, production_batch_id uuid not null, variant_id uuid not null,
  quantity numeric(18,4) not null check (quantity > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, outlet_id, production_batch_id) references public.production_batches(organization_id, outlet_id, id),
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create table public.production_outputs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, production_batch_id uuid not null, variant_id uuid not null,
  quantity numeric(18,4) not null check (quantity > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, outlet_id, production_batch_id) references public.production_batches(organization_id, outlet_id, id),
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create table public.waste_records (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, variant_id uuid not null, quantity numeric(18,4) not null check (quantity > 0),
  reason text not null check (length(trim(reason)) > 0), recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, variant_id uuid not null, quantity numeric(18,4) not null check (quantity <> 0),
  reason text not null check (reason in ('adjustment','sale','receipt','production_input','production_output','waste')),
  reference_id uuid, note text not null, actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create table public.customers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  name text not null, phone text, email text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id)
);
create table public.promotions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, code text not null, discount_percent numeric(5,2) not null check (discount_percent > 0 and discount_percent <= 100),
  starts_at timestamptz not null, ends_at timestamptz not null, check (ends_at > starts_at),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id), unique (organization_id, outlet_id, code),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id)
);
create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, name text not null, kind text not null check (kind in ('cash','bank','ewallet')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id), unique (organization_id, outlet_id, id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id)
);
create table public.cashier_shifts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, cashier_id uuid not null references public.profiles(id), cash_account_id uuid not null,
  opening_cash numeric(18,2) not null check (opening_cash >= 0), closing_cash numeric(18,2) check (closing_cash >= 0),
  opened_at timestamptz not null default now(), closed_at timestamptz, check (closed_at is null or closed_at >= opened_at),
  check ((closed_at is null) = (closing_cash is null)),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, outlet_id, id),
  foreign key (organization_id, outlet_id, cash_account_id) references public.cash_accounts(organization_id, outlet_id, id)
);
create unique index cashier_one_open_shift on public.cashier_shifts(organization_id, cashier_id) where closed_at is null;
create unique index cash_account_one_open_shift on public.cashier_shifts(cash_account_id) where closed_at is null;
create table public.orders (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, customer_id uuid, cashier_shift_id uuid not null, cashier_id uuid not null references public.profiles(id),
  idempotency_key uuid not null, request_payload jsonb not null,
  status text not null default 'paid' check (status in ('paid','partially_refunded','refunded')),
  subtotal numeric(18,2) not null check (subtotal >= 0), discount numeric(18,2) not null default 0 check (discount >= 0 and discount <= subtotal),
  total numeric(18,2) not null check (total = subtotal - discount), promotion_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, outlet_id, id), unique (organization_id, idempotency_key),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, customer_id) references public.customers(organization_id, id),
  foreign key (organization_id, promotion_id) references public.promotions(organization_id, id),
  foreign key (organization_id, outlet_id, cashier_shift_id) references public.cashier_shifts(organization_id, outlet_id, id)
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, order_id uuid not null, variant_id uuid not null, product_name text not null,
  quantity numeric(18,4) not null check (quantity > 0), unit_price numeric(18,2) not null check (unit_price >= 0),
  line_total numeric(18,2) not null check (line_total = round(quantity * unit_price, 2)),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, outlet_id, order_id) references public.orders(organization_id, outlet_id, id),
  foreign key (organization_id, variant_id) references public.product_variants(organization_id, id)
);
create table public.payments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, order_id uuid not null, cash_account_id uuid not null,
  amount numeric(18,2) not null check (amount >= 0), method text not null check (method in ('cash','bank','ewallet')),
  received_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, order_id), unique (organization_id, outlet_id, order_id, id),
  foreign key (organization_id, outlet_id, order_id) references public.orders(organization_id, outlet_id, id),
  foreign key (organization_id, outlet_id, cash_account_id) references public.cash_accounts(organization_id, outlet_id, id)
);
create table public.refunds (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, order_id uuid not null, payment_id uuid not null, idempotency_key uuid not null,
  amount numeric(18,2) not null check (amount > 0), reason text not null check (length(trim(reason)) > 0),
  approved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, idempotency_key),
  foreign key (organization_id, outlet_id, order_id, payment_id) references public.payments(organization_id, outlet_id, order_id, id)
);
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), name text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id), unique (organization_id, name)
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, expense_category_id uuid not null, cash_account_id uuid not null,
  amount numeric(18,2) not null check (amount > 0), description text not null, incurred_on date not null default current_date,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  foreign key (organization_id, expense_category_id) references public.expense_categories(organization_id, id),
  foreign key (organization_id, outlet_id, cash_account_id) references public.cash_accounts(organization_id, outlet_id, id)
);
create table public.cash_movements (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, cash_account_id uuid not null, amount numeric(18,2) not null check (amount <> 0),
  reason text not null check (reason in ('sale','refund','expense','loan','loan_payment','adjustment')),
  reference_id uuid, actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, outlet_id, cash_account_id) references public.cash_accounts(organization_id, outlet_id, id)
);
create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  code text not null, name text not null, kind text not null check (kind in ('asset','liability','equity','revenue','expense')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id), unique (organization_id, code)
);
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), outlet_id uuid,
  entry_date date not null default current_date, description text not null, idempotency_key uuid not null,
  posted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, idempotency_key),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id)
);
create table public.journal_lines (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  journal_entry_id uuid not null, financial_account_id uuid not null,
  debit numeric(18,2) not null default 0, credit numeric(18,2) not null default 0,
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, journal_entry_id) references public.journal_entries(organization_id, id),
  foreign key (organization_id, financial_account_id) references public.financial_accounts(organization_id, id)
);
create table public.assets (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), outlet_id uuid,
  name text not null, acquired_on date not null, acquisition_cost numeric(18,2) not null check (acquisition_cost >= 0),
  useful_life_months integer not null check (useful_life_months > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  unique (organization_id, id), foreign key (organization_id, outlet_id) references public.outlets(organization_id, id)
);
create table public.loans (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  lender text not null, principal numeric(18,2) not null check (principal > 0), annual_interest_percent numeric(7,4) not null default 0 check (annual_interest_percent >= 0),
  started_on date not null, due_on date not null check (due_on >= started_on),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create table public.loan_payments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null, loan_id uuid not null, cash_account_id uuid not null,
  principal_amount numeric(18,2) not null check (principal_amount >= 0), interest_amount numeric(18,2) not null default 0 check (interest_amount >= 0),
  check (principal_amount + interest_amount > 0), paid_on date not null default current_date,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), foreign key (organization_id, loan_id) references public.loans(organization_id, id),
  foreign key (organization_id, outlet_id, cash_account_id) references public.cash_accounts(organization_id, outlet_id, id)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), outlet_id uuid,
  actor_id uuid references public.profiles(id), table_name text not null, record_id uuid not null, action text not null,
  -- No row snapshots: tokens, customer PII and financial values are not copied to logs.
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), foreign key (organization_id, outlet_id) references public.outlets(organization_id, id)
);
create table public.application_settings (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  key text not null check (key in ('receipt_footer','business_timezone','receipt_prefix')),
  value text not null check (length(value) <= 1000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, key)
);

-- Every FK gets an index with its referencing columns as a leading prefix.
-- This includes composite tenant/outlet references and actor references.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname,
      string_agg(quote_ident(a.attname), ', ' order by k.ordinality) as cols
    from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(attnum, ordinality)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and t.relname = any(private.pos_tables())
    group by c.conrelid, c.conname
  loop
    execute format('create index %I on %s (%s)', r.conname || '_idx', r.tbl, r.cols);
  end loop;
end;
$$;
create index orders_history_idx on public.orders(organization_id, outlet_id, created_at desc);
create index inventory_movements_history_idx on public.inventory_movements(organization_id, outlet_id, variant_id, created_at desc);
create index audit_logs_history_idx on public.audit_logs(organization_id, created_at desc);
create index journal_entries_date_idx on public.journal_entries(organization_id, entry_date);
-- No table becomes available to the API before its policies are installed.
do $$
declare t text;
begin
  foreach t in array private.pos_tables() loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$$;
commit;
