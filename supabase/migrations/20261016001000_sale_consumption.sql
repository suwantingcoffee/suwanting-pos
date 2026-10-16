begin;
do $$ begin execute format('grant pos_identity,pos_writer,pos_auditor to %I with inherit true',current_user); end; $$;

create function private.prepare_sale_consumption() returns trigger language plpgsql security definer set search_path='' as $$
declare v public.product_variants; r public.recipes; item record; qty numeric; cost numeric; consumed jsonb:='[]'; total numeric:=0; snapshot jsonb;
begin
  select * into v from public.product_variants where id=new.variant_id and organization_id=new.organization_id for share;
  if not v.is_active or v.archived_at is not null or not exists(select 1 from public.products where id=v.product_id and is_active and archived_at is null) then
    raise exception 'Active product required' using errcode='22023'; end if;
  if v.consumption_mode='recipe' then
    select * into r from public.recipes where id=v.sale_recipe_id and organization_id=new.organization_id and output_variant_id=v.id and archived_at is null for share;
    if r.id is null or not exists(select 1 from public.recipe_items where recipe_id=r.id) then raise exception 'Active sale recipe required' using errcode='22023'; end if;
    snapshot:=private.recipe_snapshot(r.id);
    for item in select * from public.recipe_items where recipe_id=r.id order by variant_id for share loop
      qty:=private.convert_quantity(new.organization_id,item.variant_id,item.unit_id,item.quantity)*new.quantity*v.sale_quantity/
        private.convert_quantity(new.organization_id,v.id,r.output_unit_id,r.yield_quantity);
      if qty<=0 or qty<>round(qty,4) then raise exception 'Recipe consumption exceeds stock precision' using errcode='22023'; end if;
      cost:=private.apply_stock(new.organization_id,new.outlet_id,null,item.variant_id,-qty,'sale',new.order_id,'Recipe sale consumption');
      consumed:=consumed||jsonb_build_array(jsonb_build_object('variant_id',item.variant_id,'quantity',qty,'total_cost',cost));
      total:=total+cost;
    end loop;
  elsif v.consumption_mode='stock' and v.track_inventory then
    qty:=new.quantity*v.sale_quantity;
    cost:=private.apply_stock(new.organization_id,new.outlet_id,null,v.id,-qty,'sale',new.order_id,'Stocked product sale');
    total:=cost;
    consumed:=jsonb_build_array(jsonb_build_object('variant_id',v.id,'quantity',qty,'total_cost',cost));
  else total:=v.acquisition_cost*new.quantity*v.sale_quantity;
  end if;
  new.cost_total:=round(total,6);
  new.recipe_snapshot:=jsonb_build_object('mode',v.consumption_mode,'sale_quantity',v.sale_quantity,'recipe',snapshot,'consumptions',consumed);
  return new;
end; $$;
create function private.persist_sale_consumption() returns trigger language plpgsql security definer set search_path='' as $$ begin
  insert into public.order_item_consumptions(organization_id,outlet_id,order_item_id,variant_id,quantity,total_cost)
    select new.organization_id,new.outlet_id,new.id,x.variant_id,x.quantity,x.total_cost
    from jsonb_to_recordset(new.recipe_snapshot->'consumptions') as x(variant_id uuid,quantity numeric,total_cost numeric);
  return null;
end; $$;
create trigger prepare_sale_consumption before insert on public.order_items for each row execute function private.prepare_sale_consumption();
create trigger persist_sale_consumption after insert on public.order_items for each row execute function private.persist_sale_consumption();

create function private.guard_variant_mode() returns trigger language plpgsql security definer set search_path='' as $$ begin
  if (new.consumption_mode is distinct from old.consumption_mode or new.track_inventory is distinct from old.track_inventory
      or new.archived_at is distinct from old.archived_at or new.is_active is distinct from old.is_active)
    and exists(select 1 from public.inventory_balances where variant_id=old.id and quantity>0) then
    raise exception 'Clear remaining stock before changing stock mode or archiving/deactivating' using errcode='23514'; end if;
  if new.consumption_mode='recipe' and (new.sale_recipe_id is null or not exists(select 1 from public.recipes where id=new.sale_recipe_id and organization_id=new.organization_id and output_variant_id=new.id and archived_at is null)) then
    raise exception 'Recipe must produce this variant' using errcode='23514'; end if;
  return new;
end; $$;
create trigger guard_variant_mode before update on public.product_variants for each row execute function private.guard_variant_mode();

grant create on schema private to pos_writer;
alter function private.prepare_sale_consumption() owner to pos_writer;
alter function private.persist_sale_consumption() owner to pos_writer;
alter function private.guard_variant_mode() owner to pos_writer;
revoke create on schema private from pos_writer;
revoke all on function private.prepare_sale_consumption(),private.persist_sale_consumption(),private.guard_variant_mode() from public,anon,authenticated;

-- The full checkout replacement below retains authorization, pricing, payment,
-- and idempotency logic; the item trigger is now the sole stock consumption path.

create or replace function public.checkout(p_organization_id uuid, p_outlet_id uuid, p_shift_id uuid,
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

do $$ begin execute format('revoke pos_identity,pos_writer,pos_auditor from %I',current_user); end; $$;
commit;