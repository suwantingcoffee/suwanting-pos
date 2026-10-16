-- Forward-only POS lifecycle. Existing receipts/items/ledgers are retained.
begin;
do $$ begin execute format('grant pos_identity,pos_writer,pos_auditor to %I with inherit true',current_user); end; $$;

alter table public.outlets add column pos_tax_percent numeric(5,2) not null default 0
  check (pos_tax_percent between 0 and 100 and pos_tax_percent::text not in ('NaN','Infinity','-Infinity'));
alter table public.orders add column pos_version integer not null default 1 check (pos_version in (1,2));
alter table public.orders add column payment_status text not null default 'paid'
  check (payment_status in ('pending','paid','failed','partial','refunded','partially_refunded'));
alter table public.orders add column tax_percent numeric(5,2) not null default 0 check (tax_percent between 0 and 100 and tax_percent::text <> 'NaN');
alter table public.orders add column tax numeric(18,2) not null default 0 check (tax >= 0 and tax::text <> 'NaN');
alter table public.orders add column pricing_snapshot jsonb;
alter table public.orders add column receipt_snapshot jsonb;
alter table public.orders add column receipt_number text;
alter table public.orders add column revision integer not null default 1 check (revision > 0);
alter table public.orders add column finalized_at timestamptz;
alter table public.orders add column void_reason text;
alter table public.orders add column voided_by uuid references public.profiles(id);
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('paid','partially_refunded','refunded','held','pending','completed','voided'));
alter table public.orders drop constraint orders_check1;
alter table public.orders add constraint orders_total_check check (total = subtotal - discount + tax);
alter table public.orders add constraint orders_v2_lifecycle check (pos_version=1 or
  (status in ('held','pending','completed','voided') and (status='completed')=(finalized_at is not null)
    and pricing_snapshot is not null and receipt_number is not null and receipt_snapshot is not null));
create unique index orders_receipt_number_idx on public.orders(organization_id,receipt_number) where receipt_number is not null;
create index orders_pos_status_idx on public.orders(organization_id,outlet_id,status,payment_status,created_at desc,id);
create index orders_voided_by_idx on public.orders(voided_by);

-- Backfill only the new status column; preserve the legacy order status.
do $$ begin execute format('create policy pos_migration on public.orders to %I using(true) with check(true)',current_user); end; $$;
update public.orders set payment_status=status where status in ('partially_refunded','refunded');
drop policy pos_migration on public.orders;

alter table public.order_items add column sku_snapshot text;
alter table public.order_items add column variant_name text;
alter table public.order_items add column note text not null default '' check (length(note)<=500);
alter table public.order_items add column consumption_plan jsonb;
alter table public.payments drop constraint payments_organization_id_order_id_key;
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check check (method in ('cash','bank','ewallet','transfer','qris','card'));
alter table public.payments add column tendered_amount numeric(18,2) check (tendered_amount>=amount and tendered_amount::text <> 'NaN');
alter table public.payments add column change_amount numeric(18,2) not null default 0 check (change_amount>=0 and change_amount::text <> 'NaN');
alter table public.refunds add column tax_amount numeric(18,2) not null default 0 check (tax_amount>=0 and tax_amount<=amount and tax_amount::text <> 'NaN');
alter table public.refunds add column settlement_reference text check (length(settlement_reference) between 3 and 200);
create unique index refunds_settlement_reference_idx on public.refunds(organization_id,lower(trim(settlement_reference))) where settlement_reference is not null;

create table public.pos_payment_attempts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), outlet_id uuid not null,
  order_id uuid not null, cash_account_id uuid not null, idempotency_key uuid not null,
  method text not null check (method in ('cash','transfer','qris','card')),
  amount numeric(18,2) not null check (amount>0 and amount::text <> 'NaN'),
  tendered_amount numeric(18,2) not null check (tendered_amount>=amount and tendered_amount::text <> 'NaN'),
  status text not null check (status in ('pending','paid','failed','cancelled')),
  requested_by uuid not null references public.profiles(id), resolved_by uuid references public.profiles(id),
  settlement_reference text check (length(trim(settlement_reference)) between 3 and 200),
  resolution_note text check (length(trim(resolution_note)) between 3 and 500),
  resolved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,outlet_id,order_id,id), unique (organization_id,idempotency_key),
  foreign key (organization_id,outlet_id,order_id) references public.orders(organization_id,outlet_id,id),
  foreign key (organization_id,outlet_id,cash_account_id) references public.cash_accounts(organization_id,outlet_id,id),
  check ((status='pending')=(resolved_at is null)),
  check (status<>'paid' or method='cash' or (resolved_by is not null and settlement_reference is not null and resolution_note is not null))
);
create unique index pos_settlement_reference_idx on public.pos_payment_attempts(organization_id,lower(trim(settlement_reference))) where status='paid' and settlement_reference is not null;
create index pos_attempts_order_idx on public.pos_payment_attempts(organization_id,outlet_id,order_id,created_at,id);
create index pos_attempts_account_idx on public.pos_payment_attempts(organization_id,outlet_id,cash_account_id);
create index pos_attempts_requested_idx on public.pos_payment_attempts(requested_by);
create index pos_attempts_resolved_idx on public.pos_payment_attempts(resolved_by);
alter table public.payments add column attempt_id uuid;
alter table public.payments add foreign key (organization_id,outlet_id,order_id,attempt_id) references public.pos_payment_attempts(organization_id,outlet_id,order_id,id);
create unique index payments_attempt_idx on public.payments(attempt_id) where attempt_id is not null;
create index payments_attempt_fk_idx on public.payments(organization_id,outlet_id,order_id,attempt_id);
create index payments_order_idx on public.payments(organization_id,order_id);

alter table public.pos_payment_attempts enable row level security;
alter table public.pos_payment_attempts force row level security;
revoke all on public.pos_payment_attempts from public,anon,authenticated;
grant select on public.pos_payment_attempts to authenticated,pos_writer;
grant insert,update on public.pos_payment_attempts to pos_writer;
create policy internal_read on public.pos_payment_attempts for select to pos_writer using(true);
create policy internal_insert on public.pos_payment_attempts for insert to pos_writer with check(true);
create policy internal_update on public.pos_payment_attempts for update to pos_writer using(true) with check(true);
create policy tenant_read on public.pos_payment_attempts for select to authenticated using (
  private.can_access(organization_id,outlet_id,array['owner','admin','manager','cashier','finance_staff']::public.app_role[]));
create trigger touch_updated_at before update on public.pos_payment_attempts for each row execute function private.touch_updated_at();
create trigger audit_change after insert or update or delete on public.pos_payment_attempts for each row execute function private.audit_change();

-- Keep the existing registry, adding only this module's new table.
alter function private.pos_tables() rename to pre_pos_tables;
create function private.pos_tables() returns text[] language sql immutable set search_path='' as $$
  select private.pre_pos_tables()||array['pos_payment_attempts']::text[];
$$;
revoke all on function private.pre_pos_tables(),private.pos_tables() from public,anon,authenticated;
grant execute on function private.pos_tables(),private.pre_pos_tables() to pos_writer;

alter table public.cash_movements drop constraint cash_movements_reason_check;
alter table public.cash_movements add constraint cash_movements_reason_check
  check (reason in ('sale','refund','expense','loan','loan_payment','adjustment','pos_collection','pos_refund'));
drop trigger post_cash_journal on public.cash_movements;
create trigger post_cash_journal after insert on public.cash_movements for each row
  when (new.reason not in ('pos_collection','pos_refund')) execute function private.post_cash_journal();

create function private.initialize_pos_chart() returns trigger language plpgsql security definer set search_path='' as $$ begin
  insert into public.financial_accounts(organization_id,code,name,kind) values
    (new.id,'2100-POS','Uang muka pelanggan POS','liability'),(new.id,'2200-POS','Utang pajak penjualan POS','liability');
  return new;
end; $$;
create trigger initialize_pos_chart after insert on public.organizations for each row execute function private.initialize_pos_chart();
insert into public.financial_accounts(organization_id,code,name,kind)
  select o.id,x.code,x.name,'liability' from public.organizations o cross join
    (values ('2100-POS','Uang muka pelanggan POS'),('2200-POS','Utang pajak penjualan POS')) x(code,name)
  on conflict (organization_id,code) do nothing;
do $$ begin
  if exists(select 1 from public.financial_accounts where code in ('2100-POS','2200-POS') and (kind<>'liability' or archived_at is not null)) then
    raise exception 'POS account code collision: review accounts before applying migration'; end if;
end; $$;
create or replace function private.protect_system_account() returns trigger language plpgsql set search_path='' as $$ begin
  if old.code in ('1000','2000','4000','5000','6000','2100-POS','2200-POS') and
    (new.code<>old.code or new.kind<>old.kind or new.archived_at is distinct from old.archived_at) then
    raise exception 'System account code, kind and active status are fixed' using errcode='23514'; end if;
  return new;
end; $$;
grant create on schema private to pos_writer;
alter function private.initialize_pos_chart() owner to pos_writer;
revoke create on schema private from pos_writer;
revoke all on function private.initialize_pos_chart() from public,anon,authenticated;
do $$ begin execute format('revoke pos_identity,pos_writer,pos_auditor from %I',current_user); end; $$;
commit;
