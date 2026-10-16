begin;
do $$ begin execute format('grant pos_identity,pos_writer,pos_auditor to %I with inherit true',current_user); end; $$;

create function private.convert_quantity(p_org uuid,p_variant uuid,p_unit uuid,p_quantity numeric) returns numeric
language plpgsql stable set search_path='' as $$
declare src public.units; dst public.units; converted numeric;
begin
  if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'Finite quantity required' using errcode='22023'; end if;
  select u.* into dst from public.product_variants v join public.units u on u.id=v.unit_id and u.organization_id=v.organization_id
    where v.id=p_variant and v.organization_id=p_org;
  select * into src from public.units where id=coalesce(p_unit,dst.id) and organization_id=p_org and archived_at is null;
  if src.id is null or dst.id is null or src.dimension<>dst.dimension or (src.dimension='custom' and src.id<>dst.id) then
    raise exception 'Incompatible unit or organization' using errcode='22023'; end if;
  converted:=p_quantity*src.factor_to_base/dst.factor_to_base;
  if converted<>round(converted,4) or abs(converted)>1000000000000 then
    raise exception 'Quantity exceeds stock precision (4 decimals)' using errcode='22023'; end if;
  return converted;
end; $$;

-- Caller holds outlet advisory locks in sorted UUID order. Every legacy and
-- current stock path shares the same aggregate-row then location-row lock order.
create function private.apply_stock(p_org uuid,p_outlet uuid,p_location uuid,p_variant uuid,p_delta numeric,
  p_reason text,p_reference uuid,p_note text,p_cost numeric default null,p_operation uuid default null) returns numeric
language plpgsql set search_path='' as $$
declare loc uuid; b public.inventory_location_balances; delta_value numeric; unit_cost numeric; aq numeric;
begin
  if p_delta is null or p_delta=0 or p_delta<>round(p_delta,4) or p_delta::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Invalid stock quantity' using errcode='23514'; end if;
  if p_cost<0 or p_cost::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid stock cost' using errcode='22023'; end if;
  perform 1 from public.product_variants v join public.products p on p.id=v.product_id
    where v.id=p_variant and v.organization_id=p_org and v.track_inventory and v.consumption_mode='stock'
      and v.is_active and p.is_active and v.archived_at is null and p.archived_at is null for share of v,p;
  if not found then raise exception 'Active stocked variant required' using errcode='22023'; end if;
  select id into loc from public.storage_locations where organization_id=p_org and outlet_id=p_outlet
    and archived_at is null and (id=p_location or (p_location is null and is_default));
  if loc is null then raise exception 'Active storage location required' using errcode='22023'; end if;
  insert into public.inventory_balances(organization_id,outlet_id,variant_id) values(p_org,p_outlet,p_variant)
    on conflict(organization_id,outlet_id,variant_id) do nothing;
  perform 1 from public.inventory_balances where organization_id=p_org and outlet_id=p_outlet and variant_id=p_variant for update;
  insert into public.inventory_location_balances(organization_id,outlet_id,storage_location_id,variant_id)
    values(p_org,p_outlet,loc,p_variant) on conflict(storage_location_id,variant_id) do nothing;
  select * into b from public.inventory_location_balances where storage_location_id=loc and variant_id=p_variant for update;
  if b.quantity+p_delta<0 then raise exception 'Insufficient stock at selected location' using errcode='23514'; end if;
  if p_delta<0 then
    delta_value:=case when -p_delta=b.quantity then -b.inventory_value else round(p_delta*b.inventory_value/nullif(b.quantity,0),6) end;
  else
    if p_cost is null then
      select acquisition_cost into unit_cost from public.product_variants where id=p_variant;
    else unit_cost:=p_cost; end if;
    delta_value:=round(p_delta*unit_cost,6);
  end if;
  update public.inventory_location_balances set quantity=quantity+p_delta,inventory_value=inventory_value+delta_value,revision=revision+1 where id=b.id;
  update public.inventory_balances set quantity=quantity+p_delta,inventory_value=greatest(0,inventory_value+delta_value)
    where organization_id=p_org and outlet_id=p_outlet and variant_id=p_variant returning quantity into aq;
  insert into public.inventory_movements(organization_id,outlet_id,storage_location_id,variant_id,quantity,reason,reference_id,note,actor_id,
    operation_id,unit_cost,total_cost,balance_after,location_balance_after)
    values(p_org,p_outlet,loc,p_variant,p_delta,p_reason,p_reference,p_note,auth.uid(),p_operation,
      abs(delta_value/p_delta),delta_value,aq,b.quantity+p_delta);
  return abs(delta_value);
end; $$;
create or replace function private.move_stock(p_org uuid,p_outlet uuid,p_variant uuid,p_delta numeric,p_reason text,p_reference uuid,p_note text) returns void
language plpgsql set search_path='' as $$ begin
  perform private.apply_stock(p_org,p_outlet,null,p_variant,p_delta,p_reason,p_reference,p_note);
end; $$;

create function private.start_inventory_operation(p_org uuid,p_outlet uuid,p_key uuid,p_kind text,p_payload jsonb) returns uuid
language plpgsql set search_path='' as $$
declare op public.inventory_operations;
begin
  if p_key is null then raise exception 'Request key required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||p_key::text,17));
  select * into op from public.inventory_operations where organization_id=p_org and request_key=p_key;
  if found then
    if op.actor_id<>auth.uid() or op.outlet_id<>p_outlet or op.kind<>p_kind or op.payload<>p_payload then
      raise exception 'Request key reused with different payload or actor' using errcode='22023'; end if;
    return op.id;
  end if;
  insert into public.inventory_operations(organization_id,outlet_id,request_key,kind,payload,actor_id)
    values(p_org,p_outlet,p_key,p_kind,p_payload,auth.uid()) returning id into op.id;
  return op.id;
end; $$;

-- Stocktake is an absolute count with an optimistic revision. Adjustment is a
-- signed delta. A retry with identical key returns the original committed result.
create function public.mutate_stock(p_organization_id uuid,p_outlet_id uuid,p_location_id uuid,p_variant_id uuid,
  p_kind text,p_quantity numeric,p_unit_id uuid,p_note text,p_request_key uuid,p_unit_cost numeric default 0,
  p_destination_location_id uuid default null,p_expected_revision bigint default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare op uuid; qty numeric; cost numeric; dst public.storage_locations; b public.inventory_location_balances; rec uuid; lock_id uuid;
begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','manager','inventory_staff']::public.app_role[]);
  if p_kind not in ('incoming','outgoing','transfer','adjustment','stocktake','waste') or p_kind is null
    or length(trim(coalesce(p_note,'')))=0 then raise exception 'Operation and reason required' using errcode='22023'; end if;
  if not exists(select 1 from public.storage_locations where id=p_location_id and organization_id=p_organization_id and outlet_id=p_outlet_id and archived_at is null) then
    raise exception 'Invalid source location' using errcode='22023'; end if;
  qty:=private.convert_quantity(p_organization_id,p_variant_id,p_unit_id,p_quantity);
  if (p_kind='stocktake' and qty<0) or (p_kind<>'adjustment' and p_kind<>'stocktake' and qty<=0) then
    raise exception 'Positive quantity required' using errcode='22023'; end if;
  if p_kind='transfer' then
    select * into dst from public.storage_locations where id=p_destination_location_id and organization_id=p_organization_id and archived_at is null;
    if dst.id is null or dst.id=p_location_id then raise exception 'Different destination required' using errcode='22023'; end if;
    perform private.require_access(p_organization_id,dst.outlet_id,array['owner','admin','manager','inventory_staff']::public.app_role[]);
  end if;
  op:=private.start_inventory_operation(p_organization_id,p_outlet_id,p_request_key,p_kind,jsonb_build_object(
    'location',p_location_id,'variant',p_variant_id,'quantity',p_quantity,'unit',p_unit_id,'note',p_note,
    'cost',p_unit_cost,'destination',p_destination_location_id,'revision',p_expected_revision));
  if (select result<>'{}'::jsonb from public.inventory_operations where id=op) then return op; end if;
  for lock_id in select distinct x from unnest(array[p_outlet_id,dst.outlet_id]) x where x is not null order by x loop
    perform pg_advisory_xact_lock(hashtextextended(lock_id::text,0));
  end loop;
  if p_kind='stocktake' then
    select * into b from public.inventory_location_balances where storage_location_id=p_location_id and variant_id=p_variant_id;
    if p_expected_revision is null or p_expected_revision<>coalesce(b.revision,0) then raise exception 'Stock changed; reload and recount' using errcode='40001'; end if;
    qty:=qty-coalesce(b.quantity,0);
  end if;
  if p_kind in ('outgoing','waste','transfer') then qty:=-qty; end if;
  if p_kind='waste' then
    insert into public.waste_records(organization_id,outlet_id,variant_id,quantity,reason,recorded_by)
      values(p_organization_id,p_outlet_id,p_variant_id,-qty,p_note,auth.uid()) returning id into rec;
  end if;
  -- Cost is entered per selected input unit; ledger quantity/cost use variant's stock unit.
  if qty<>0 then
    cost:=private.apply_stock(p_organization_id,p_outlet_id,p_location_id,p_variant_id,qty,
      case when p_kind='transfer' then 'transfer_out' else p_kind end,coalesce(rec,op),p_note,
      case when qty>0 then p_unit_cost/nullif(private.convert_quantity(p_organization_id,p_variant_id,p_unit_id,1),0) else null end,op);
    if p_kind='transfer' then
      perform private.apply_stock(p_organization_id,dst.outlet_id,dst.id,p_variant_id,-qty,'transfer_in',op,p_note,cost/(-qty),op);
    end if;
  end if;
  update public.inventory_operations set result=jsonb_build_object('id',op,'cost',cost,'delta',qty) where id=op;
  return op;
end; $$;

create function public.set_minimum_stock(p_organization_id uuid,p_outlet_id uuid,p_variant_id uuid,p_quantity numeric) returns void
language plpgsql security definer set search_path='' as $$ begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','manager','inventory_staff']::public.app_role[]);
  if p_quantity is null or p_quantity<0 or p_quantity<>round(p_quantity,4) or p_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid minimum' using errcode='22023'; end if;
  insert into public.inventory_balances(organization_id,outlet_id,variant_id,minimum_stock) values(p_organization_id,p_outlet_id,p_variant_id,p_quantity)
    on conflict(organization_id,outlet_id,variant_id) do update set minimum_stock=excluded.minimum_stock;
end; $$;
create function public.list_stock(p_organization_id uuid,p_outlet_id uuid,p_location_id uuid default null,p_search text default '',
  p_low_only boolean default false,p_page integer default 1,p_page_size integer default 20) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_page<1 or p_page_size not between 1 and 100 then raise exception 'Invalid pagination' using errcode='22023'; end if;
  with rows as (
    select v.id,v.sku,v.name,p.name product_name,u.code unit_code,v.unit_id,
      coalesce(case when p_location_id is null then b.quantity else lb.quantity end,0) quantity,
      coalesce(case when p_location_id is null then b.inventory_value else lb.inventory_value end,0) inventory_value,
      coalesce(b.minimum_stock,0) minimum_stock,coalesce(lb.revision,0) revision
    from public.product_variants v join public.products p on p.id=v.product_id join public.units u on u.id=v.unit_id
    left join public.inventory_balances b on b.variant_id=v.id and b.outlet_id=p_outlet_id
    left join public.inventory_location_balances lb on lb.variant_id=v.id and lb.storage_location_id=p_location_id and lb.outlet_id=p_outlet_id
    where v.organization_id=p_organization_id and v.track_inventory and v.consumption_mode='stock' and v.archived_at is null and p.archived_at is null
      and private.can_access(p_organization_id,p_outlet_id,array['owner','admin','manager','inventory_staff','finance_staff']::public.app_role[])
      and (p_location_id is null or exists(select 1 from public.storage_locations l where l.id=p_location_id and l.outlet_id=p_outlet_id and l.organization_id=p_organization_id))
      and (coalesce(p_search,'')='' or strpos(lower(p.name||' '||v.name||' '||v.sku||' '||coalesce(v.barcode,'')),lower(p_search))>0)
  ), filtered as (select * from rows where not p_low_only or quantity<=minimum_stock),
  page as (select * from filtered order by product_name,name,id limit p_page_size offset (p_page-1)*p_page_size)
  select jsonb_build_object('count',(select count(*) from filtered),'rows',coalesce(jsonb_agg(to_jsonb(page) order by product_name,name,id),'[]'::jsonb)) into result from page;
  return result;
end; $$;

-- Only the reviewed RPC allowlist is executable by API sessions.
grant create on schema public,private to pos_writer;
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in ('convert_quantity','apply_stock','move_stock','start_inventory_operation'))
      or (n.nspname='public' and p.proname in ('mutate_stock','set_minimum_stock','list_stock')) loop
    execute format('alter function %s owner to pos_writer',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.signature); end if;
  end loop;
end; $$;
revoke create on schema public,private from pos_writer;
do $$ begin execute format('revoke pos_identity,pos_writer,pos_auditor from %I',current_user); end; $$;
commit;
