begin;
do $$ begin execute format('grant pos_identity,pos_writer,pos_auditor to %I with inherit true',current_user); end; $$;

alter table public.assets add column cash_account_id uuid;
alter table public.assets add column idempotency_key uuid;
alter table public.assets add constraint assets_cash_account_fkey
  foreign key (organization_id,outlet_id,cash_account_id)
  references public.cash_accounts(organization_id,outlet_id,id);
create index assets_cash_account_fk_idx on public.assets(organization_id,outlet_id,cash_account_id);
create unique index assets_idempotency_key on public.assets(organization_id,idempotency_key) where idempotency_key is not null;
alter table public.expenses add column idempotency_key uuid;
create unique index expenses_idempotency_key on public.expenses(organization_id,idempotency_key) where idempotency_key is not null;
alter table public.loans add column idempotency_key uuid;
create unique index loans_idempotency_key on public.loans(organization_id,idempotency_key) where idempotency_key is not null;
alter table public.loan_payments add column idempotency_key uuid;
alter table public.loan_payments add column fee_amount numeric(18,2) not null default 0 check(fee_amount>=0);
create unique index loan_payments_idempotency_key on public.loan_payments(organization_id,idempotency_key) where idempotency_key is not null;

create table public.capital_contributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null,
  cash_account_id uuid not null,
  amount numeric(18,2) not null check(amount>0),
  contributor text not null check(length(trim(contributor)) between 1 and 160),
  description text not null check(length(trim(description)) between 1 and 500),
  idempotency_key uuid not null,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,id),
  unique(organization_id,idempotency_key),
  foreign key(organization_id,outlet_id,cash_account_id) references public.cash_accounts(organization_id,outlet_id,id)
);
create table public.income_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null,
  cash_account_id uuid not null,
  amount numeric(18,2) not null check(amount>0),
  description text not null check(length(trim(description)) between 1 and 500),
  received_on date not null default current_date,
  idempotency_key uuid not null,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,id),
  unique(organization_id,idempotency_key),
  foreign key(organization_id,outlet_id,cash_account_id) references public.cash_accounts(organization_id,outlet_id,id)
);
create table public.cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  outlet_id uuid not null,
  shift_id uuid not null,
  expected_cash numeric(18,2) not null check(expected_cash>=0),
  actual_cash numeric(18,2) not null check(actual_cash>=0),
  variance numeric(18,2) not null,
  idempotency_key uuid not null,
  reconciled_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,id),
  unique(organization_id,shift_id),
  unique(organization_id,idempotency_key),
  foreign key(organization_id,outlet_id,shift_id) references public.cashier_shifts(organization_id,outlet_id,id)
);
create index income_records_cash_account_fk_idx on public.income_records(organization_id,outlet_id,cash_account_id);
create index income_records_recorded_by_fk_idx on public.income_records(recorded_by);
create index capital_contributions_cash_account_fk_idx on public.capital_contributions(organization_id,outlet_id,cash_account_id);
create index capital_contributions_recorded_by_fk_idx on public.capital_contributions(recorded_by);
create index cash_reconciliations_shift_fk_idx on public.cash_reconciliations(organization_id,outlet_id,shift_id);
create index cash_reconciliations_reconciled_by_fk_idx on public.cash_reconciliations(reconciled_by);
alter table public.journal_entries add column reversal_of uuid;
alter table public.journal_entries add constraint journal_entries_reversal_fkey
  foreign key(organization_id,reversal_of) references public.journal_entries(organization_id,id);
create index journal_entries_reversal_fk_idx on public.journal_entries(organization_id,reversal_of);
create unique index journal_entries_one_reversal on public.journal_entries(organization_id,reversal_of) where reversal_of is not null;
alter table public.cash_movements drop constraint cash_movements_reason_check;
alter table public.cash_movements add constraint cash_movements_reason_check
  check(reason in ('sale','refund','expense','loan','loan_payment','adjustment','pos_collection','pos_refund','capital','other_income','asset_purchase'));

alter function private.pos_tables() rename to pre_finance_tables;
create function private.pos_tables() returns text[] language sql immutable set search_path='' as $$
  select private.pre_finance_tables()||array['capital_contributions','income_records','cash_reconciliations']::text[];
$$;
revoke all on function private.pre_finance_tables(),private.pos_tables() from public,anon,authenticated;
grant execute on function private.pre_finance_tables(),private.pos_tables() to pos_writer;

do $$
declare org record;
begin
  for org in select id from public.organizations loop
    insert into public.financial_accounts(organization_id,code,name,kind) values
      (org.id,'1500','Aset tetap','asset'),
      (org.id,'3000','Modal pemilik','equity'),
      (org.id,'4100','Pendapatan lain-lain','revenue'),
      (org.id,'5100','Selisih kas kurang','expense'),
      (org.id,'6100','Biaya pinjaman','expense')
    on conflict(organization_id,code) do nothing;
  end loop;
end;
$$;

create or replace function private.initialize_chart() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.financial_accounts(organization_id,code,name,kind) values
    (new.id,'1000','Kas dan bank','asset'),
    (new.id,'1500','Aset tetap','asset'),
    (new.id,'2000','Utang pinjaman','liability'),
    (new.id,'3000','Modal pemilik','equity'),
    (new.id,'4000','Pendapatan penjualan','revenue'),
    (new.id,'4100','Pendapatan lain-lain','revenue'),
    (new.id,'5000','Beban operasional','expense'),
    (new.id,'5100','Selisih kas kurang','expense'),
    (new.id,'6000','Beban bunga','expense'),
    (new.id,'6100','Biaya pinjaman','expense');
  return new;
end;
$$;

create or replace function private.protect_system_account() returns trigger language plpgsql set search_path='' as $$
begin
  if old.code in ('1000','1500','2000','3000','4000','4100','5000','5100','6000','6100') and
    (new.code<>old.code or new.kind<>old.kind or new.archived_at is distinct from old.archived_at) then
    raise exception 'System account code, kind and active status are fixed' using errcode='23514';
  end if;
  return new;
end;
$$;

create or replace function private.post_cash_journal() returns trigger language plpgsql security definer set search_path='' as $$
declare entry uuid; cash uuid; counter uuid; principal numeric; interest numeric; fee numeric;
begin
  select id into cash from public.financial_accounts where organization_id=new.organization_id and code='1000';
  if new.reason='sale' then select id into counter from public.financial_accounts where organization_id=new.organization_id and code='4000';
  elsif new.reason='refund' then select id into counter from public.financial_accounts where organization_id=new.organization_id and code='4000';
  elsif new.reason='expense' then select id into counter from public.financial_accounts where organization_id=new.organization_id and code='5000';
  elsif new.reason='loan' then select id into counter from public.financial_accounts where organization_id=new.organization_id and code='2000';
  elsif new.reason='loan_payment' then select id into counter from public.financial_accounts where organization_id=new.organization_id and code='2000';
  elsif new.reason='capital' then select id into counter from public.financial_accounts where organization_id=new.organization_id and code='3000';
  elsif new.reason='other_income' then select id into counter from public.financial_accounts where organization_id=new.organization_id and code='4100';
  elsif new.reason='asset_purchase' then select id into counter from public.financial_accounts where organization_id=new.organization_id and code='1500';
  elsif new.reason='adjustment' then
    if new.amount>0 then select id into counter from public.financial_accounts where organization_id=new.organization_id and code='4100';
    else select id into counter from public.financial_accounts where organization_id=new.organization_id and code='5100'; end if;
  else raise exception 'No automatic journal mapping for cash movement' using errcode='23514';
  end if;
  if cash is null or counter is null then raise exception 'Finance chart of accounts is incomplete' using errcode='23514'; end if;
  insert into public.journal_entries(organization_id,outlet_id,description,idempotency_key,posted_by)
    values(new.organization_id,new.outlet_id,new.reason,new.id,auth.uid()) returning id into entry;
  if new.reason='loan_payment' then
    select principal_amount,interest_amount,fee_amount into principal,interest,fee from public.loan_payments where id=new.reference_id;
    insert into public.journal_lines(organization_id,journal_entry_id,financial_account_id,debit,credit)
      values(new.organization_id,entry,cash,0,principal+interest+fee);
    if principal>0 then insert into public.journal_lines(organization_id,journal_entry_id,financial_account_id,debit,credit)
      values(new.organization_id,entry,counter,principal,0); end if;
    if interest>0 then insert into public.journal_lines(organization_id,journal_entry_id,financial_account_id,debit,credit)
      select new.organization_id,entry,id,interest,0 from public.financial_accounts where organization_id=new.organization_id and code='6000'; end if;
    if fee>0 then insert into public.journal_lines(organization_id,journal_entry_id,financial_account_id,debit,credit)
      select new.organization_id,entry,id,fee,0 from public.financial_accounts where organization_id=new.organization_id and code='6100'; end if;
  elsif new.reason='adjustment' and new.amount<0 then
    insert into public.journal_lines(organization_id,journal_entry_id,financial_account_id,debit,credit)
      values(new.organization_id,entry,counter,-new.amount,0),(new.organization_id,entry,cash,0,-new.amount);
  else
    insert into public.journal_lines(organization_id,journal_entry_id,financial_account_id,debit,credit)
      values(new.organization_id,entry,cash,greatest(new.amount,0),greatest(-new.amount,0)),
        (new.organization_id,entry,counter,greatest(-new.amount,0),greatest(new.amount,0));
  end if;
  return new;
end;
$$;

create function public.record_income(p_organization_id uuid,p_outlet_id uuid,p_cash_account_id uuid,
  p_amount numeric,p_description text,p_received_on date,p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare rec uuid; existing public.income_records;
begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','manager','finance_staff']::public.app_role[]);
  if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2)
    or length(trim(coalesce(p_description,''))) not between 1 and 500 or p_received_on is null then
    raise exception 'Invalid income details' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_idempotency_key::text,0));
  select * into existing from public.income_records where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.outlet_id is distinct from p_outlet_id or existing.cash_account_id is distinct from p_cash_account_id or existing.amount is distinct from p_amount
      or existing.description is distinct from trim(p_description) or existing.received_on is distinct from p_received_on then raise exception 'Idempotency conflict' using errcode='22023'; end if;
    return existing.id;
  end if;
  if not exists(select 1 from public.cash_accounts where id=p_cash_account_id and organization_id=p_organization_id and outlet_id=p_outlet_id and archived_at is null) then
    raise exception 'Active payment account required' using errcode='22023'; end if;
  insert into public.income_records(organization_id,outlet_id,cash_account_id,amount,description,received_on,idempotency_key,recorded_by)
    values(p_organization_id,p_outlet_id,p_cash_account_id,p_amount,trim(p_description),p_received_on,p_idempotency_key,auth.uid()) returning id into rec;
  insert into public.cash_movements(organization_id,outlet_id,cash_account_id,amount,reason,reference_id,actor_id)
    values(p_organization_id,p_outlet_id,p_cash_account_id,p_amount,'other_income',rec,auth.uid());
  return rec;
end;
$$;

create function public.record_capital_contribution(p_organization_id uuid,p_outlet_id uuid,p_cash_account_id uuid,
  p_amount numeric,p_contributor text,p_description text,p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare rec uuid; existing public.capital_contributions;
begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','finance_staff']::public.app_role[]);
  if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2)
    or length(trim(coalesce(p_contributor,''))) not between 1 and 160 or length(trim(coalesce(p_description,''))) not between 1 and 500 then
    raise exception 'Invalid capital contribution details' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_idempotency_key::text,0));
  select * into existing from public.capital_contributions where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.outlet_id is distinct from p_outlet_id or existing.cash_account_id is distinct from p_cash_account_id or existing.amount is distinct from p_amount
      or existing.contributor is distinct from trim(p_contributor) or existing.description is distinct from trim(p_description) then raise exception 'Idempotency conflict' using errcode='22023'; end if;
    return existing.id;
  end if;
  if not exists(select 1 from public.cash_accounts where id=p_cash_account_id and organization_id=p_organization_id and outlet_id=p_outlet_id and archived_at is null) then
    raise exception 'Active cash account required' using errcode='22023'; end if;
  insert into public.capital_contributions(organization_id,outlet_id,cash_account_id,amount,contributor,description,idempotency_key,recorded_by)
    values(p_organization_id,p_outlet_id,p_cash_account_id,p_amount,trim(p_contributor),trim(p_description),p_idempotency_key,auth.uid()) returning id into rec;
  insert into public.cash_movements(organization_id,outlet_id,cash_account_id,amount,reason,reference_id,actor_id)
    values(p_organization_id,p_outlet_id,p_cash_account_id,p_amount,'capital',rec,auth.uid());
  return rec;
end;
$$;

create function public.record_asset_purchase(p_organization_id uuid,p_outlet_id uuid,p_cash_account_id uuid,
  p_name text,p_acquired_on date,p_amount numeric,p_useful_life_months integer,p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare rec uuid; existing public.assets;
begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','finance_staff']::public.app_role[]);
  if p_idempotency_key is null or length(trim(coalesce(p_name,''))) not between 1 and 160 or p_acquired_on is null or
    p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) or
    p_useful_life_months is null or p_useful_life_months not between 1 and 1200 then raise exception 'Invalid asset purchase' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_idempotency_key::text,0));
  select * into existing from public.assets where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.outlet_id is distinct from p_outlet_id or existing.cash_account_id is distinct from p_cash_account_id or existing.name is distinct from trim(p_name)
      or existing.acquired_on is distinct from p_acquired_on or existing.acquisition_cost is distinct from p_amount
      or existing.useful_life_months is distinct from p_useful_life_months then raise exception 'Idempotency conflict' using errcode='22023'; end if;
    return existing.id;
  end if;
  if not exists(select 1 from public.cash_accounts where id=p_cash_account_id and organization_id=p_organization_id and outlet_id=p_outlet_id and archived_at is null) then
    raise exception 'Active payment account required' using errcode='22023'; end if;
  insert into public.assets(organization_id,outlet_id,cash_account_id,idempotency_key,name,acquired_on,acquisition_cost,useful_life_months)
    values(p_organization_id,p_outlet_id,p_cash_account_id,p_idempotency_key,trim(p_name),p_acquired_on,p_amount,p_useful_life_months) returning id into rec;
  insert into public.cash_movements(organization_id,outlet_id,cash_account_id,amount,reason,reference_id,actor_id)
    values(p_organization_id,p_outlet_id,p_cash_account_id,-p_amount,'asset_purchase',rec,auth.uid());
  return rec;
end;
$$;

create function public.record_expense_once(p_organization_id uuid,p_outlet_id uuid,p_category_id uuid,p_cash_account_id uuid,
  p_amount numeric,p_description text,p_incurred_on date,p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare rec uuid; existing public.expenses;
begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','manager','finance_staff']::public.app_role[]);
  if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2)
    or length(trim(coalesce(p_description,''))) not between 1 and 500 or p_incurred_on is null then raise exception 'Invalid expense details' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_idempotency_key::text,0));
  select * into existing from public.expenses where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.outlet_id is distinct from p_outlet_id or existing.expense_category_id is distinct from p_category_id or existing.cash_account_id is distinct from p_cash_account_id
      or existing.amount is distinct from p_amount or existing.description is distinct from trim(p_description) or existing.incurred_on is distinct from p_incurred_on then
      raise exception 'Idempotency conflict' using errcode='22023'; end if;
    return existing.id;
  end if;
  if not exists(select 1 from public.cash_accounts where id=p_cash_account_id and organization_id=p_organization_id and outlet_id=p_outlet_id and archived_at is null)
    or not exists(select 1 from public.expense_categories where id=p_category_id and organization_id=p_organization_id and archived_at is null) then
    raise exception 'Active account and expense category required' using errcode='22023'; end if;
  insert into public.expenses(organization_id,outlet_id,expense_category_id,cash_account_id,amount,description,incurred_on,recorded_by,idempotency_key)
    values(p_organization_id,p_outlet_id,p_category_id,p_cash_account_id,p_amount,trim(p_description),p_incurred_on,auth.uid(),p_idempotency_key) returning id into rec;
  insert into public.cash_movements(organization_id,outlet_id,cash_account_id,amount,reason,reference_id,actor_id)
    values(p_organization_id,p_outlet_id,p_cash_account_id,-p_amount,'expense',rec,auth.uid());
  return rec;
end;
$$;

create function public.record_loan(p_organization_id uuid,p_outlet_id uuid,p_cash_account_id uuid,p_lender text,
  p_principal numeric,p_interest_percent numeric,p_started_on date,p_due_on date,p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare rec uuid; existing public.loans;
begin
  perform private.require_access(p_organization_id,null,array['owner','admin','finance_staff']::public.app_role[]);
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','finance_staff']::public.app_role[]);
  if p_idempotency_key is null or length(trim(coalesce(p_lender,''))) not between 1 and 160 or p_principal is null or p_principal<=0 or
    p_principal::text in ('NaN','Infinity','-Infinity') or p_principal<>round(p_principal,2) or p_interest_percent is null or
    p_interest_percent<0 or p_interest_percent>100 or p_started_on is null or p_due_on<p_started_on then raise exception 'Invalid loan terms' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_idempotency_key::text,0));
  select * into existing from public.loans where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.lender is distinct from trim(p_lender) or existing.principal is distinct from p_principal or existing.annual_interest_percent is distinct from p_interest_percent
      or existing.started_on is distinct from p_started_on or existing.due_on is distinct from p_due_on then raise exception 'Idempotency conflict' using errcode='22023'; end if;
    return existing.id;
  end if;
  if not exists(select 1 from public.cash_accounts where id=p_cash_account_id and organization_id=p_organization_id and outlet_id=p_outlet_id and archived_at is null) then
    raise exception 'Active payment account required' using errcode='22023'; end if;
  insert into public.loans(organization_id,lender,principal,annual_interest_percent,started_on,due_on,idempotency_key)
    values(p_organization_id,trim(p_lender),p_principal,p_interest_percent,p_started_on,p_due_on,p_idempotency_key) returning id into rec;
  insert into public.cash_movements(organization_id,outlet_id,cash_account_id,amount,reason,reference_id,actor_id)
    values(p_organization_id,p_outlet_id,p_cash_account_id,p_principal,'loan',rec,auth.uid());
  return rec;
end;
$$;

create function public.record_loan_payment(p_loan_id uuid,p_outlet_id uuid,p_cash_account_id uuid,
  p_principal numeric,p_interest numeric,p_fee numeric,p_paid_on date,p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare loan public.loans; paid numeric; rec uuid; existing public.loan_payments;
begin
  select * into loan from public.loans where id=p_loan_id;
  perform private.require_access(loan.organization_id,null,array['owner','admin','finance_staff']::public.app_role[]);
  perform private.require_access(loan.organization_id,p_outlet_id,array['owner','admin','finance_staff']::public.app_role[]);
  if p_idempotency_key is null or p_principal is null or p_interest is null or p_fee is null or
    p_principal<0 or p_interest<0 or p_fee<0 or p_principal+p_interest+p_fee<=0 or
    p_principal::text in ('NaN','Infinity','-Infinity') or p_interest::text in ('NaN','Infinity','-Infinity') or p_fee::text in ('NaN','Infinity','-Infinity') or
    p_principal<>round(p_principal,2) or p_interest<>round(p_interest,2) or p_fee<>round(p_fee,2) or p_paid_on is null then raise exception 'Invalid loan payment' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(loan.organization_id::text||p_idempotency_key::text,0));
  select * into existing from public.loan_payments where organization_id=loan.organization_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.loan_id is distinct from p_loan_id or existing.outlet_id is distinct from p_outlet_id or existing.cash_account_id is distinct from p_cash_account_id
      or existing.principal_amount is distinct from p_principal or existing.interest_amount is distinct from p_interest
      or existing.fee_amount is distinct from p_fee or existing.paid_on is distinct from p_paid_on
      then raise exception 'Idempotency conflict' using errcode='22023'; end if;
    return existing.id;
  end if;
  select * into loan from public.loans where id=p_loan_id for update;
  select coalesce(sum(principal_amount),0) into paid from public.loan_payments where loan_id=loan.id;
  if paid+p_principal>loan.principal then raise exception 'Principal overpayment' using errcode='23514'; end if;
  if not exists(select 1 from public.cash_accounts where id=p_cash_account_id and organization_id=loan.organization_id and outlet_id=p_outlet_id and archived_at is null) then
    raise exception 'Active payment account required' using errcode='22023'; end if;
  insert into public.loan_payments(organization_id,outlet_id,loan_id,cash_account_id,principal_amount,interest_amount,fee_amount,paid_on,recorded_by,idempotency_key)
    values(loan.organization_id,p_outlet_id,loan.id,p_cash_account_id,p_principal,p_interest,p_fee,p_paid_on,auth.uid(),p_idempotency_key) returning id into rec;
  insert into public.cash_movements(organization_id,outlet_id,cash_account_id,amount,reason,reference_id,actor_id)
    values(loan.organization_id,p_outlet_id,p_cash_account_id,-(p_principal+p_interest+p_fee),'loan_payment',rec,auth.uid());
  return rec;
end;
$$;

create function public.reconcile_cashier_shift(p_shift_id uuid,p_actual_cash numeric,p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.cashier_shifts; existing public.cash_reconciliations; expected numeric; rec uuid; delta numeric;
begin
  select * into s from public.cashier_shifts where id=p_shift_id;
  perform private.require_access(s.organization_id,s.outlet_id,array['owner','admin','manager','finance_staff']::public.app_role[]);
  if s.id is null or s.closed_at is null then raise exception 'Closed shift required before reconciliation' using errcode='22023'; end if;
  if p_actual_cash is null or p_actual_cash<0 or p_actual_cash::text in ('NaN','Infinity','-Infinity') or p_actual_cash<>round(p_actual_cash,2) or p_idempotency_key is null then
    raise exception 'Invalid reconciliation amount or key' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(s.id::text,0));
  select * into existing from public.cash_reconciliations where organization_id=s.organization_id and shift_id=s.id;
  if found then
    if existing.actual_cash is distinct from p_actual_cash then raise exception 'Shift already reconciled with a different amount' using errcode='22023'; end if;
    return existing.id;
  end if;
  expected:=s.opening_cash+coalesce((select sum(amount) from public.cash_movements
    where organization_id=s.organization_id and outlet_id=s.outlet_id and cash_account_id=s.cash_account_id
      and created_at>=s.opened_at and created_at<=s.closed_at),0);
  delta:=p_actual_cash-expected;
  insert into public.cash_reconciliations(organization_id,outlet_id,shift_id,expected_cash,actual_cash,variance,idempotency_key,reconciled_by)
    values(s.organization_id,s.outlet_id,s.id,expected,p_actual_cash,delta,p_idempotency_key,auth.uid()) returning id into rec;
  if delta<>0 then
    insert into public.cash_movements(organization_id,outlet_id,cash_account_id,amount,reason,reference_id,actor_id)
      values(s.organization_id,s.outlet_id,s.cash_account_id,delta,'adjustment',rec,auth.uid());
  end if;
  return rec;
end;
$$;

create function public.reverse_journal_entry(p_journal_entry_id uuid,p_reason text,p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare original public.journal_entries; rec uuid; existing public.journal_entries;
begin
  select * into original from public.journal_entries where id=p_journal_entry_id;
  perform private.require_access(original.organization_id,original.outlet_id,array['owner','admin','manager']::public.app_role[]);
  if original.id is null or p_idempotency_key is null or length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Valid journal and reversal reason required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(original.organization_id::text||p_idempotency_key::text,0));
  select * into existing from public.journal_entries where organization_id=original.organization_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.reversal_of is distinct from original.id or existing.description is distinct from 'Reversal: '||trim(p_reason) then raise exception 'Idempotency conflict' using errcode='22023'; end if;
    return existing.id;
  end if;
  if exists(select 1 from public.journal_entries where organization_id=original.organization_id and reversal_of=original.id) then
    raise exception 'Journal already reversed; use a separate adjustment for further corrections' using errcode='23514'; end if;
  insert into public.journal_entries(organization_id,outlet_id,entry_date,description,idempotency_key,posted_by,reversal_of)
    values(original.organization_id,original.outlet_id,current_date,'Reversal: '||trim(p_reason),p_idempotency_key,auth.uid(),original.id) returning id into rec;
  insert into public.journal_lines(organization_id,journal_entry_id,financial_account_id,debit,credit)
    select organization_id,rec,financial_account_id,credit,debit from public.journal_lines where journal_entry_id=original.id;
  return rec;
end;
$$;

create function public.finance_overview(p_organization_id uuid,p_outlet_id uuid,p_from date,p_until date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','manager','finance_staff']::public.app_role[]);
  if p_from is null or p_until is null or p_until<=p_from or p_until-p_from>366 then raise exception 'Invalid finance date range' using errcode='22023'; end if;
  select jsonb_build_object(
    'gross_sales',coalesce((select sum(total) from public.orders where organization_id=p_organization_id and outlet_id=p_outlet_id and status='completed' and created_at>=p_from::timestamptz and created_at<p_until::timestamptz),0),
    'payments_received',coalesce((select sum(amount) from public.payments where organization_id=p_organization_id and outlet_id=p_outlet_id and created_at>=p_from::timestamptz and created_at<p_until::timestamptz),0),
    'refunds',coalesce((select sum(amount) from public.refunds where organization_id=p_organization_id and outlet_id=p_outlet_id and created_at>=p_from::timestamptz and created_at<p_until::timestamptz),0),
    'pending_settlement',coalesce((select sum(amount) from public.pos_payment_attempts where organization_id=p_organization_id and outlet_id=p_outlet_id and status='pending' and created_at<p_until::timestamptz),0),
    'cash_in',coalesce((select sum(amount) from public.cash_movements where organization_id=p_organization_id and outlet_id=p_outlet_id and amount>0 and created_at>=p_from::timestamptz and created_at<p_until::timestamptz),0),
    'cash_out',coalesce((select -sum(amount) from public.cash_movements where organization_id=p_organization_id and outlet_id=p_outlet_id and amount<0 and created_at>=p_from::timestamptz and created_at<p_until::timestamptz),0),
    'other_income',coalesce((select sum(amount) from public.income_records where organization_id=p_organization_id and outlet_id=p_outlet_id and received_on>=p_from and received_on<p_until),0),
    'operating_expenses',coalesce((select sum(amount) from public.expenses where organization_id=p_organization_id and outlet_id=p_outlet_id and incurred_on>=p_from and incurred_on<p_until),0),
    'asset_purchases',coalesce((select sum(acquisition_cost) from public.assets where organization_id=p_organization_id and outlet_id=p_outlet_id and acquired_on>=p_from and acquired_on<p_until),0),
    'owner_capital',coalesce((select sum(amount) from public.capital_contributions where organization_id=p_organization_id and outlet_id=p_outlet_id and created_at>=p_from::timestamptz and created_at<p_until::timestamptz),0),
    'loan_proceeds',coalesce((select sum(amount) from public.cash_movements where organization_id=p_organization_id and outlet_id=p_outlet_id and reason='loan' and created_at>=p_from::timestamptz and created_at<p_until::timestamptz),0),
    'loan_principal_paid',coalesce((select sum(principal_amount) from public.loan_payments where organization_id=p_organization_id and outlet_id=p_outlet_id and paid_on>=p_from and paid_on<p_until),0),
    'loan_interest_paid',coalesce((select sum(interest_amount) from public.loan_payments where organization_id=p_organization_id and outlet_id=p_outlet_id and paid_on>=p_from and paid_on<p_until),0),
    'loan_fees_paid',coalesce((select sum(fee_amount) from public.loan_payments where organization_id=p_organization_id and outlet_id=p_outlet_id and paid_on>=p_from and paid_on<p_until),0),
    'open_shifts',(select count(*) from public.cashier_shifts where organization_id=p_organization_id and outlet_id=p_outlet_id and closed_at is null),
    'unreconciled_shifts',(select count(*) from public.cashier_shifts s left join public.cash_reconciliations r on r.shift_id=s.id where s.organization_id=p_organization_id and s.outlet_id=p_outlet_id and s.closed_at is not null and r.id is null),
    'account_balances',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'kind',a.kind,'balance',coalesce(m.balance,0)) order by a.name,a.id)
      from public.cash_accounts a left join (select cash_account_id,sum(amount) balance from public.cash_movements where organization_id=p_organization_id and outlet_id=p_outlet_id group by cash_account_id) m on m.cash_account_id=a.id
      where a.organization_id=p_organization_id and a.outlet_id=p_outlet_id and a.archived_at is null),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function private.guard_finance_write() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Financial source records are append-only; create a reversal or correction entry' using errcode='42501'; end;
$$;
do $$
declare t text;
begin
  foreach t in array array['capital_contributions','income_records','cash_reconciliations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant select,insert on public.%I to pos_writer',t);
    execute format('create policy internal_read on public.%I for select to pos_writer using(true)',t);
    execute format('create policy internal_insert on public.%I for insert to pos_writer with check(true)',t);
    execute format('create policy finance_read on public.%I for select to authenticated using(private.can_access(organization_id,outlet_id,array[''owner'',''admin'',''manager'',''finance_staff'']::public.app_role[]))',t);
    execute format('create trigger audit_change after insert on public.%I for each row execute function private.audit_change()',t);
    execute format('create trigger append_only before update or delete on public.%I for each row execute function private.guard_finance_write()',t);
  end loop;
end;
$$;
grant insert on public.assets to pos_writer;
create policy internal_insert on public.assets for insert to pos_writer with check(true);
drop policy tenant_insert on public.assets;
drop policy tenant_update on public.assets;
revoke insert,update on public.assets from authenticated;
create policy finance_activity_read on public.audit_logs for select to authenticated using(
  table_name in ('expenses','cash_movements','cashier_shifts','cash_reconciliations','capital_contributions','income_records',
    'assets','loans','loan_payments','journal_entries','journal_lines','payments','refunds')
  and private.can_access(organization_id,outlet_id,array['owner','admin','manager','finance_staff']::public.app_role[])
);
grant create on schema public,private to pos_writer;
alter function private.guard_finance_write() owner to pos_writer;
alter function public.record_income(uuid,uuid,uuid,numeric,text,date,uuid) owner to pos_writer;
alter function public.record_capital_contribution(uuid,uuid,uuid,numeric,text,text,uuid) owner to pos_writer;
alter function public.record_asset_purchase(uuid,uuid,uuid,text,date,numeric,integer,uuid) owner to pos_writer;
alter function public.record_expense_once(uuid,uuid,uuid,uuid,numeric,text,date,uuid) owner to pos_writer;
alter function public.record_loan(uuid,uuid,uuid,text,numeric,numeric,date,date,uuid) owner to pos_writer;
alter function public.record_loan_payment(uuid,uuid,uuid,numeric,numeric,numeric,date,uuid) owner to pos_writer;
alter function public.reconcile_cashier_shift(uuid,numeric,uuid) owner to pos_writer;
alter function public.reverse_journal_entry(uuid,text,uuid) owner to pos_writer;
alter function public.finance_overview(uuid,uuid,date,date) owner to pos_writer;
revoke all on function public.record_income(uuid,uuid,uuid,numeric,text,date,uuid),
  public.record_capital_contribution(uuid,uuid,uuid,numeric,text,text,uuid),
  public.record_asset_purchase(uuid,uuid,uuid,text,date,numeric,integer,uuid),
  public.record_expense_once(uuid,uuid,uuid,uuid,numeric,text,date,uuid),
  public.record_loan(uuid,uuid,uuid,text,numeric,numeric,date,date,uuid),
  public.record_loan_payment(uuid,uuid,uuid,numeric,numeric,numeric,date,uuid),
  public.reconcile_cashier_shift(uuid,numeric,uuid),public.reverse_journal_entry(uuid,text,uuid),public.finance_overview(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.record_income(uuid,uuid,uuid,numeric,text,date,uuid),
  public.record_capital_contribution(uuid,uuid,uuid,numeric,text,text,uuid),
  public.record_asset_purchase(uuid,uuid,uuid,text,date,numeric,integer,uuid),
  public.record_expense_once(uuid,uuid,uuid,uuid,numeric,text,date,uuid),
  public.record_loan(uuid,uuid,uuid,text,numeric,numeric,date,date,uuid),
  public.record_loan_payment(uuid,uuid,uuid,numeric,numeric,numeric,date,uuid),
  public.reconcile_cashier_shift(uuid,numeric,uuid),public.reverse_journal_entry(uuid,text,uuid),public.finance_overview(uuid,uuid,date,date) to authenticated;
revoke create on schema public,private from pos_writer;
revoke all on function private.guard_finance_write() from public,anon,authenticated;
do $$ begin execute format('revoke pos_identity,pos_writer,pos_auditor from %I',current_user); end; $$;
commit;
