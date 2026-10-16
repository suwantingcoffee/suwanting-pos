begin;
create function public.create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.organizations(name) values (p_name) returning id into org;
  insert into public.organization_members(organization_id, user_id, role) values (org, auth.uid(), 'owner');
  return org;
end;
$$;
create function public.set_member(p_organization_id uuid, p_user_id uuid, p_role public.app_role,
  p_outlet_id uuid default null, p_is_active boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare old_member public.organization_members;
begin
  -- Serialize all membership changes before authorization: concurrent owner
  -- demotions must not remove the last active owner.
  perform 1 from public.organizations where id = p_organization_id for update;
  perform private.require_access(p_organization_id, null, array['owner']::public.app_role[]);
  select * into old_member from public.organization_members where organization_id = p_organization_id and user_id = p_user_id;
  if old_member.role = 'owner' and old_member.is_active and (p_role <> 'owner' or not p_is_active) and
    (select count(*) from public.organization_members where organization_id = p_organization_id and role = 'owner' and is_active) <= 1 then
    raise exception 'Cannot remove the last owner' using errcode = '23514';
  end if;
  insert into public.organization_members(organization_id, user_id, role, outlet_id, is_active)
  values (p_organization_id, p_user_id, p_role, p_outlet_id, p_is_active)
  on conflict (organization_id, user_id) do update set role = excluded.role, outlet_id = excluded.outlet_id, is_active = excluded.is_active;
end;
$$;

-- All inventory operations use a database-owned balance and append-only ledger.
-- No public EXECUTE grant. Locking by outlet serializes multi-product operations.
create function private.move_stock(p_org uuid, p_outlet uuid, p_variant uuid, p_delta numeric,
  p_reason text, p_reference uuid, p_note text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_delta is null or p_delta = 0 or p_delta <> round(p_delta, 4) then
    raise exception 'Invalid stock quantity' using errcode = '22023';
  end if;
  if not exists (select 1 from public.product_variants v join public.products p on p.id = v.product_id and p.organization_id = v.organization_id
    where v.id = p_variant and v.organization_id = p_org and v.track_inventory and v.archived_at is null and p.archived_at is null) then
    raise exception 'Active inventory variant required' using errcode = '22023';
  end if;
  insert into public.inventory_balances(organization_id, outlet_id, variant_id)
    values (p_org, p_outlet, p_variant) on conflict (organization_id, outlet_id, variant_id) do nothing;
  update public.inventory_balances set quantity = quantity + p_delta
    where organization_id = p_org and outlet_id = p_outlet and variant_id = p_variant;
  insert into public.inventory_movements(organization_id, outlet_id, variant_id, quantity, reason, reference_id, note, actor_id)
    values (p_org, p_outlet, p_variant, p_delta, p_reason, p_reference, p_note, auth.uid());
end;
$$;
create function public.adjust_inventory(p_organization_id uuid, p_outlet_id uuid, p_variant_id uuid,
  p_quantity numeric, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_access(p_organization_id, p_outlet_id, array['owner','admin','manager','inventory_staff']::public.app_role[]);
  if p_outlet_id is null or p_reason is null or length(trim(p_reason)) = 0 then raise exception 'Outlet and reason required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text, 0));
  perform private.move_stock(p_organization_id, p_outlet_id, p_variant_id, p_quantity, 'adjustment', null, p_reason);
end;
$$;
create function public.record_waste(p_organization_id uuid, p_outlet_id uuid, p_variant_id uuid,
  p_quantity numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rec uuid;
begin
  perform private.require_access(p_organization_id, p_outlet_id, array['owner','admin','manager','inventory_staff']::public.app_role[]);
  if p_quantity is null or p_quantity <= 0 then raise exception 'Positive quantity required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text, 0));
  insert into public.waste_records(organization_id, outlet_id, variant_id, quantity, reason, recorded_by)
    values (p_organization_id, p_outlet_id, p_variant_id, p_quantity, p_reason, auth.uid()) returning id into rec;
  perform private.move_stock(p_organization_id, p_outlet_id, p_variant_id, -p_quantity, 'waste', rec, p_reason);
  return rec;
end;
$$;
create function public.open_shift(p_organization_id uuid, p_outlet_id uuid, p_cash_account_id uuid, p_opening_cash numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rec uuid;
begin
  perform private.require_access(p_organization_id, p_outlet_id, array['owner','admin','manager','cashier']::public.app_role[]);
  if not exists (select 1 from public.cash_accounts where id = p_cash_account_id and organization_id = p_organization_id
    and outlet_id = p_outlet_id and kind = 'cash' and archived_at is null) then raise exception 'Active cash drawer required' using errcode = '22023'; end if;
  insert into public.cashier_shifts(organization_id, outlet_id, cashier_id, cash_account_id, opening_cash)
    values (p_organization_id, p_outlet_id, auth.uid(), p_cash_account_id, p_opening_cash) returning id into rec;
  return rec;
end;
$$;
create function public.close_shift(p_shift_id uuid, p_closing_cash numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts;
begin
  select * into s from public.cashier_shifts where id = p_shift_id;
  perform private.require_access(s.organization_id, s.outlet_id, array['owner','admin','manager','cashier']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended(s.outlet_id::text, 0));
  select * into s from public.cashier_shifts where id = p_shift_id for update;
  if s.cashier_id <> auth.uid() and not private.can_access(s.organization_id, s.outlet_id, array['owner','admin','manager']::public.app_role[]) then
    raise exception 'Cannot close another cashier shift' using errcode = '42501'; end if;
  if s.closed_at is not null or p_closing_cash is null then raise exception 'Shift already closed or amount missing' using errcode = '22023'; end if;
  update public.cashier_shifts set closed_at = now(), closing_cash = p_closing_cash where id = s.id;
end;
$$;

create function public.checkout(p_organization_id uuid, p_outlet_id uuid, p_shift_id uuid,
  p_idempotency_key uuid, p_items jsonb, p_cash_account_id uuid, p_customer_id uuid default null,
  p_promotion_code text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  rec uuid; pay uuid; s public.cashier_shifts; v record; item record; promo public.promotions;
  existing public.orders; payload jsonb; subtotal numeric(18,2) := 0; discount numeric(18,2) := 0;
  account_kind text;
begin
  perform private.require_access(p_organization_id, p_outlet_id, array['owner','admin','manager','cashier']::public.app_role[]);
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Items array required' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception '1-100 items required' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) <> 'object'
    or (x - 'variant_id' - 'quantity') <> '{}'::jsonb or not (x ? 'variant_id' and x ? 'quantity')
    or jsonb_typeof(x->'variant_id') <> 'string' or jsonb_typeof(x->'quantity') <> 'number') then
    raise exception 'Items accept only variant_id and numeric quantity' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(quantity numeric)
    where quantity is null or quantity <= 0 or quantity > 100000 or quantity <> round(quantity,4)) then
    raise exception 'Invalid item quantity' using errcode = '22023'; end if;
  payload := jsonb_build_object('items', p_items, 'shift', p_shift_id, 'account', p_cash_account_id,
    'customer', p_customer_id, 'promotion', p_promotion_code);
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text, 0));
  select * into existing from public.orders where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    if existing.outlet_id <> p_outlet_id or existing.cashier_id <> auth.uid() or existing.request_payload <> payload then
      raise exception 'Idempotency key conflicts with another request' using errcode = '22023'; end if;
    return existing.id;
  end if;
  select * into s from public.cashier_shifts where id = p_shift_id and organization_id = p_organization_id and outlet_id = p_outlet_id for update;
  if not found or s.closed_at is not null or s.cashier_id <> auth.uid() then raise exception 'Own open shift required' using errcode = '42501'; end if;
  select kind into account_kind from public.cash_accounts where id = p_cash_account_id and organization_id = p_organization_id
    and outlet_id = p_outlet_id and archived_at is null;
  if not found or (account_kind = 'cash' and p_cash_account_id <> s.cash_account_id) then raise exception 'Invalid payment account' using errcode = '22023'; end if;
  if p_customer_id is not null and not exists (select 1 from public.customers where id = p_customer_id
    and organization_id = p_organization_id and archived_at is null) then raise exception 'Invalid customer' using errcode = '22023'; end if;
  if p_promotion_code is not null then
    select * into promo from public.promotions where organization_id = p_organization_id and outlet_id = p_outlet_id
      and code = p_promotion_code and archived_at is null and now() >= starts_at and now() < ends_at;
    if not found then raise exception 'Invalid promotion' using errcode = '22023'; end if;
  end if;
  -- Prices and names are locked/read from the catalog, never accepted from input.
  for item in select variant_id, sum(quantity) as quantity from jsonb_to_recordset(p_items) as x(variant_id uuid, quantity numeric) group by variant_id order by variant_id loop
    if item.quantity is null or item.quantity <= 0 or item.quantity > 100000 or item.quantity <> round(item.quantity, 4) then raise exception 'Invalid quantity' using errcode = '22023'; end if;
    select pv.* into v from public.product_variants pv join public.products p on p.id = pv.product_id and p.organization_id = pv.organization_id
      where pv.id = item.variant_id and pv.organization_id = p_organization_id and pv.archived_at is null and p.archived_at is null for share of pv, p;
    if not found then raise exception 'Invalid variant' using errcode = '22023'; end if;
    subtotal := subtotal + round(v.price * item.quantity, 2);
  end loop;
  discount := round(subtotal * coalesce(promo.discount_percent, 0) / 100, 2);
  insert into public.orders(organization_id, outlet_id, customer_id, cashier_shift_id, cashier_id, idempotency_key,
    request_payload, subtotal, discount, total, promotion_id)
    values (p_organization_id, p_outlet_id, p_customer_id, p_shift_id, auth.uid(), p_idempotency_key, payload,
      subtotal, discount, subtotal-discount, promo.id) returning id into rec;
  for item in select variant_id, sum(quantity) as quantity from jsonb_to_recordset(p_items) as x(variant_id uuid, quantity numeric) group by variant_id order by variant_id loop
    select pv.*, p.name as product_name into v from public.product_variants pv join public.products p on p.id = pv.product_id
      where pv.id = item.variant_id and pv.organization_id = p_organization_id;
    insert into public.order_items(organization_id, outlet_id, order_id, variant_id, product_name, quantity, unit_price, line_total)
      values (p_organization_id, p_outlet_id, rec, v.id, v.product_name || ' / ' || v.name, item.quantity, v.price, round(item.quantity*v.price, 2));
    if v.track_inventory then perform private.move_stock(p_organization_id, p_outlet_id, v.id, -item.quantity, 'sale', rec, 'POS sale'); end if;
  end loop;
  insert into public.payments(organization_id, outlet_id, order_id, cash_account_id, amount, method, received_by)
    values (p_organization_id, p_outlet_id, rec, p_cash_account_id, subtotal-discount, account_kind, auth.uid()) returning id into pay;
  if subtotal-discount > 0 then
    insert into public.cash_movements(organization_id, outlet_id, cash_account_id, amount, reason, reference_id, actor_id)
      values (p_organization_id, p_outlet_id, p_cash_account_id, subtotal-discount, 'sale', pay, auth.uid());
  end if;
  return rec;
end;
$$;

create function public.refund_order(p_order_id uuid, p_amount numeric, p_reason text, p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.orders; p public.payments; r public.refunds; refunded numeric; rec uuid;
begin
  select * into o from public.orders where id = p_order_id;
  perform private.require_access(o.organization_id, o.outlet_id, array['owner','admin','manager','finance_staff']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended(o.outlet_id::text, 0));
  select * into o from public.orders where id = p_order_id for update;
  select * into r from public.refunds where organization_id = o.organization_id and idempotency_key = p_idempotency_key;
  if found then
    if r.order_id is distinct from o.id or r.amount is distinct from p_amount
      or r.reason is distinct from p_reason or r.approved_by is distinct from auth.uid() then
      raise exception 'Idempotency conflict' using errcode = '22023'; end if;
    return r.id;
  end if;
  select * into p from public.payments where order_id = o.id;
  select coalesce(sum(amount),0) into refunded from public.refunds where order_id = o.id;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount,2) or refunded + p_amount > p.amount then raise exception 'Invalid refund amount' using errcode = '22023'; end if;
  insert into public.refunds(organization_id, outlet_id, order_id, payment_id, amount, reason, approved_by, idempotency_key)
    values (o.organization_id, o.outlet_id, o.id, p.id, p_amount, p_reason, auth.uid(), p_idempotency_key) returning id into rec;
  insert into public.cash_movements(organization_id, outlet_id, cash_account_id, amount, reason, reference_id, actor_id)
    values (o.organization_id, o.outlet_id, p.cash_account_id, -p_amount, 'refund', rec, auth.uid());
  update public.orders set status = case when refunded+p_amount = total then 'refunded' else 'partially_refunded' end where id = o.id;
  -- Refund of money never implies returned, reusable stock. Adjust separately.
  return rec;
end;
$$;

create function public.create_purchase_order(p_organization_id uuid, p_outlet_id uuid, p_supplier_id uuid,
  p_number text, p_items jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rec uuid; item record;
begin
  perform private.require_access(p_organization_id, p_outlet_id, array['owner','admin','manager','inventory_staff']::public.app_role[]);
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Items array required' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception '1-100 items required' using errcode = '22023'; end if;
  insert into public.purchase_orders(organization_id, outlet_id, supplier_id, number, created_by)
    values (p_organization_id, p_outlet_id, p_supplier_id, p_number, auth.uid()) returning id into rec;
  for item in select * from jsonb_to_recordset(p_items) as x(variant_id uuid, quantity numeric, unit_cost numeric) loop
    if item.quantity <> round(item.quantity,4) or item.unit_cost <> round(item.unit_cost,2) then raise exception 'Invalid precision' using errcode = '22023'; end if;
    insert into public.purchase_order_items(organization_id, outlet_id, purchase_order_id, variant_id, quantity, unit_cost)
      values (p_organization_id, p_outlet_id, rec, item.variant_id, item.quantity, item.unit_cost);
  end loop;
  return rec;
end;
$$;
create function public.approve_purchase_order(p_purchase_order_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_purchase_order_id for update;
  perform private.require_access(po.organization_id, po.outlet_id, array['owner','admin','manager']::public.app_role[]);
  if po.status <> 'draft' then raise exception 'Draft purchase order required' using errcode = '22023'; end if;
  update public.purchase_orders set status = 'approved' where id = po.id;
end;
$$;
create function public.receive_purchase_order(p_purchase_order_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; item record; rec uuid;
begin
  select * into po from public.purchase_orders where id = p_purchase_order_id;
  perform private.require_access(po.organization_id, po.outlet_id, array['owner','admin','manager','inventory_staff']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended(po.outlet_id::text, 0));
  select * into po from public.purchase_orders where id = p_purchase_order_id for update;
  if po.status = 'received' then return (select id from public.goods_receipts where purchase_order_id = po.id); end if;
  if po.status <> 'approved' then raise exception 'Approved purchase order required' using errcode = '22023'; end if;
  insert into public.goods_receipts(organization_id, outlet_id, purchase_order_id, received_by)
    values (po.organization_id, po.outlet_id, po.id, auth.uid()) returning id into rec;
  for item in select * from public.purchase_order_items where purchase_order_id = po.id order by variant_id loop
    insert into public.goods_receipt_items(organization_id, outlet_id, goods_receipt_id, purchase_order_id, purchase_order_item_id, quantity)
      values (po.organization_id, po.outlet_id, rec, po.id, item.id, item.quantity);
    perform private.move_stock(po.organization_id, po.outlet_id, item.variant_id, item.quantity, 'receipt', rec, 'Full PO receipt');
  end loop;
  update public.purchase_orders set status = 'received' where id = po.id;
  return rec;
end;
$$;
create function public.produce_batch(p_organization_id uuid, p_outlet_id uuid, p_recipe_id uuid, p_quantity numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare recipe public.recipes; item record; rec uuid; amount numeric;
begin
  perform private.require_access(p_organization_id, p_outlet_id, array['owner','admin','manager','inventory_staff']::public.app_role[]);
  if p_quantity is null or p_quantity <= 0 or p_quantity <> round(p_quantity,4) then raise exception 'Positive quantity, max 4 decimals required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text, 0));
  select * into recipe from public.recipes where id = p_recipe_id and organization_id = p_organization_id and archived_at is null for share;
  if not found or not exists (select 1 from public.recipe_items where recipe_id = recipe.id) then raise exception 'Active nonempty recipe required' using errcode = '22023'; end if;
  insert into public.production_batches(organization_id, outlet_id, recipe_id, quantity, produced_by)
    values (p_organization_id, p_outlet_id, recipe.id, p_quantity, auth.uid()) returning id into rec;
  for item in select * from public.recipe_items where recipe_id = recipe.id order by variant_id for share loop
    amount := round(item.quantity * p_quantity / recipe.yield_quantity, 4);
    if amount <= 0 then raise exception 'Input quantity rounds to zero' using errcode = '22023'; end if;
    insert into public.production_inputs(organization_id, outlet_id, production_batch_id, variant_id, quantity)
      values (p_organization_id, p_outlet_id, rec, item.variant_id, amount);
    perform private.move_stock(p_organization_id, p_outlet_id, item.variant_id, -amount, 'production_input', rec, 'Recipe input');
  end loop;
  insert into public.production_outputs(organization_id, outlet_id, production_batch_id, variant_id, quantity)
    values (p_organization_id, p_outlet_id, rec, recipe.output_variant_id, p_quantity);
  perform private.move_stock(p_organization_id, p_outlet_id, recipe.output_variant_id, p_quantity, 'production_output', rec, 'Recipe output');
  return rec;
end;
$$;

create function public.record_expense(p_organization_id uuid, p_outlet_id uuid, p_category_id uuid,
  p_cash_account_id uuid, p_amount numeric, p_description text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rec uuid;
begin
  perform private.require_access(p_organization_id, p_outlet_id, array['owner','admin','manager','finance_staff']::public.app_role[]);
  if p_amount <> round(p_amount,2) then raise exception 'Invalid amount precision' using errcode = '22023'; end if;
  if not exists (select 1 from public.cash_accounts where id = p_cash_account_id and organization_id = p_organization_id and outlet_id = p_outlet_id and archived_at is null) then raise exception 'Active cash account required' using errcode = '22023'; end if;
  insert into public.expenses(organization_id, outlet_id, expense_category_id, cash_account_id, amount, description, recorded_by)
    values (p_organization_id, p_outlet_id, p_category_id, p_cash_account_id, p_amount, p_description, auth.uid()) returning id into rec;
  insert into public.cash_movements(organization_id, outlet_id, cash_account_id, amount, reason, reference_id, actor_id)
    values (p_organization_id, p_outlet_id, p_cash_account_id, -p_amount, 'expense', rec, auth.uid());
  return rec;
end;
$$;
create function public.create_loan(p_organization_id uuid, p_outlet_id uuid, p_cash_account_id uuid,
  p_lender text, p_principal numeric, p_interest_percent numeric, p_started_on date, p_due_on date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rec uuid;
begin
  -- Loans are organization-wide and require a member with all-outlet finance access.
  perform private.require_access(p_organization_id, null, array['owner','admin','finance_staff']::public.app_role[]);
  perform private.require_access(p_organization_id, p_outlet_id, array['owner','admin','finance_staff']::public.app_role[]);
  if p_principal <> round(p_principal,2) then raise exception 'Invalid precision' using errcode = '22023'; end if;
  if not exists (select 1 from public.cash_accounts where id = p_cash_account_id and organization_id = p_organization_id and outlet_id = p_outlet_id and archived_at is null) then raise exception 'Active cash account required' using errcode = '22023'; end if;
  insert into public.loans(organization_id, lender, principal, annual_interest_percent, started_on, due_on)
    values (p_organization_id, p_lender, p_principal, p_interest_percent, p_started_on, p_due_on) returning id into rec;
  insert into public.cash_movements(organization_id, outlet_id, cash_account_id, amount, reason, reference_id, actor_id)
    values (p_organization_id, p_outlet_id, p_cash_account_id, p_principal, 'loan', rec, auth.uid());
  return rec;
end;
$$;
create function public.pay_loan(p_loan_id uuid, p_outlet_id uuid, p_cash_account_id uuid,
  p_principal numeric, p_interest numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare loan public.loans; paid numeric; rec uuid;
begin
  select * into loan from public.loans where id = p_loan_id for update;
  perform private.require_access(loan.organization_id, null, array['owner','admin','finance_staff']::public.app_role[]);
  perform private.require_access(loan.organization_id, p_outlet_id, array['owner','admin','finance_staff']::public.app_role[]);
  if p_principal <> round(p_principal,2) or p_interest <> round(p_interest,2) then raise exception 'Invalid precision' using errcode = '22023'; end if;
  if not exists (select 1 from public.cash_accounts where id = p_cash_account_id and organization_id = loan.organization_id and outlet_id = p_outlet_id and archived_at is null) then raise exception 'Active cash account required' using errcode = '22023'; end if;
  select coalesce(sum(principal_amount),0) into paid from public.loan_payments where loan_id = loan.id;
  if paid + p_principal > loan.principal then raise exception 'Principal overpayment' using errcode = '23514'; end if;
  insert into public.loan_payments(organization_id, outlet_id, loan_id, cash_account_id, principal_amount, interest_amount, recorded_by)
    values (loan.organization_id, p_outlet_id, loan.id, p_cash_account_id, p_principal, p_interest, auth.uid()) returning id into rec;
  insert into public.cash_movements(organization_id, outlet_id, cash_account_id, amount, reason, reference_id, actor_id)
    values (loan.organization_id, p_outlet_id, p_cash_account_id, -(p_principal+p_interest), 'loan_payment', rec, auth.uid());
  return rec;
end;
$$;
create function public.post_journal(p_organization_id uuid, p_outlet_id uuid, p_description text,
  p_entry_date date, p_idempotency_key uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rec uuid; item record;
begin
  perform private.require_access(p_organization_id, p_outlet_id, array['owner','admin','finance_staff']::public.app_role[]);
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Lines array required' using errcode = '22023'; end if;
  if jsonb_array_length(p_lines) not between 2 and 100 then raise exception '2-100 lines required' using errcode = '22023'; end if;
  -- A reused journal key is an explicit conflict (never silently discard new data).
  insert into public.journal_entries(organization_id, outlet_id, entry_date, description, idempotency_key, posted_by)
    values (p_organization_id, p_outlet_id, p_entry_date, p_description, p_idempotency_key, auth.uid()) returning id into rec;
  for item in select * from jsonb_to_recordset(p_lines) as x(account_id uuid, debit numeric, credit numeric) loop
    if item.debit <> round(item.debit,2) or item.credit <> round(item.credit,2) then raise exception 'Invalid precision' using errcode = '22023'; end if;
    if not exists (select 1 from public.financial_accounts where id = item.account_id and organization_id = p_organization_id and archived_at is null) then raise exception 'Active financial account required' using errcode = '22023'; end if;
    insert into public.journal_lines(organization_id, journal_entry_id, financial_account_id, debit, credit)
      values (p_organization_id, rec, item.account_id, coalesce(item.debit,0), coalesce(item.credit,0));
  end loop;
  if (select sum(debit-credit) from public.journal_lines where journal_entry_id = rec) <> 0 then raise exception 'Unbalanced journal' using errcode = '23514'; end if;
  return rec;
end;
$$;

-- Transfer ownership to the least-privileged writer, revoke default execution,
-- and expose only the reviewed public RPC list to authenticated sessions.
grant create on schema public, private to pos_writer;
alter function private.move_stock(uuid,uuid,uuid,numeric,text,uuid,text) owner to pos_writer;
revoke all on function private.move_stock(uuid,uuid,uuid,numeric,text,uuid,text) from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_organization','set_member','adjust_inventory','record_waste','open_shift',
      'close_shift','checkout','refund_order','create_purchase_order','approve_purchase_order','receive_purchase_order',
      'produce_batch','record_expense','create_loan','pay_loan','post_journal') loop
    execute format('alter function %s owner to pos_writer', f.signature);
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to authenticated', f.signature);
  end loop;
end;
$$;
revoke create on schema public, private from pos_writer;
commit;
