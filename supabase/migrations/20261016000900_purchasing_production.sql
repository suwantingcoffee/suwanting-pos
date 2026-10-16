begin;
do $$ begin execute format('grant pos_identity,pos_writer,pos_auditor to %I with inherit true',current_user); end; $$;
grant insert,update on public.recipes,public.recipe_items to pos_writer;
grant delete on public.recipe_items to pos_writer;
create policy internal_insert on public.recipes for insert to pos_writer with check(true);
create policy internal_update_recipe on public.recipes for update to pos_writer using(true) with check(true);
create policy internal_insert on public.recipe_items for insert to pos_writer with check(true);
create policy internal_update_recipe on public.recipe_items for update to pos_writer using(true) with check(true);
create policy internal_delete on public.recipe_items for delete to pos_writer using(true);
revoke insert,update on public.recipes,public.recipe_items from authenticated;

create or replace function public.create_purchase_order(p_organization_id uuid,p_outlet_id uuid,p_supplier_id uuid,p_number text,p_items jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare rec uuid; item record; qty numeric;
begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','manager','inventory_staff']::public.app_role[]);
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Items array required' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception '1-100 items required' using errcode='22023'; end if;
  if not exists(select 1 from public.suppliers where id=p_supplier_id and organization_id=p_organization_id and archived_at is null) then raise exception 'Active supplier required' using errcode='22023'; end if;
  insert into public.purchase_orders(organization_id,outlet_id,supplier_id,number,created_by)
    values(p_organization_id,p_outlet_id,p_supplier_id,p_number,auth.uid()) returning id into rec;
  for item in select * from jsonb_to_recordset(p_items) as x(variant_id uuid,quantity numeric,unit_cost numeric,unit_id uuid) loop
    if item.quantity is null or item.quantity<=0 or item.quantity<>round(item.quantity,4) or item.unit_cost is null or item.unit_cost<0 or item.unit_cost<>round(item.unit_cost,2) then raise exception 'Invalid PO item' using errcode='22023'; end if;
    qty:=private.convert_quantity(p_organization_id,item.variant_id,item.unit_id,item.quantity);
    if qty<=0 then raise exception 'Invalid PO quantity' using errcode='22023'; end if;
    insert into public.purchase_order_items(organization_id,outlet_id,purchase_order_id,variant_id,quantity,unit_cost,unit_id)
      values(p_organization_id,p_outlet_id,rec,item.variant_id,item.quantity,item.unit_cost,item.unit_id);
  end loop;
  return rec;
end; $$;
create function public.receive_purchase_order_at(p_purchase_order_id uuid,p_location_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders; item record; rec uuid; qty numeric; loc uuid;
begin
  select * into po from public.purchase_orders where id=p_purchase_order_id;
  perform private.require_access(po.organization_id,po.outlet_id,array['owner','admin','manager','inventory_staff']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended(po.outlet_id::text,0));
  select * into po from public.purchase_orders where id=p_purchase_order_id for update;
  select id into loc from public.storage_locations where organization_id=po.organization_id and outlet_id=po.outlet_id and archived_at is null
    and (id=p_location_id or (p_location_id is null and is_default));
  if loc is null then raise exception 'Invalid receipt location' using errcode='22023'; end if;
  if po.status='received' then
    select id into rec from public.goods_receipts where purchase_order_id=po.id and (storage_location_id=loc or
      (storage_location_id is null and exists(select 1 from public.storage_locations where id=loc and is_default)));
    if rec is null then raise exception 'PO already received at a different location' using errcode='22023'; end if;
    return rec;
  end if;
  if po.status<>'approved' then raise exception 'Approved purchase order required' using errcode='22023'; end if;
  insert into public.goods_receipts(organization_id,outlet_id,purchase_order_id,received_by,storage_location_id)
    values(po.organization_id,po.outlet_id,po.id,auth.uid(),loc) returning id into rec;
  for item in select * from public.purchase_order_items where purchase_order_id=po.id order by variant_id loop
    qty:=private.convert_quantity(po.organization_id,item.variant_id,item.unit_id,item.quantity);
    insert into public.goods_receipt_items(organization_id,outlet_id,goods_receipt_id,purchase_order_id,purchase_order_item_id,quantity,unit_cost,canonical_quantity)
      values(po.organization_id,po.outlet_id,rec,po.id,item.id,item.quantity,item.unit_cost,qty);
    perform private.apply_stock(po.organization_id,po.outlet_id,loc,item.variant_id,qty,'receipt',rec,'Full PO receipt',item.quantity*item.unit_cost/qty);
  end loop;
  update public.purchase_orders set status='received' where id=po.id;
  return rec;
end; $$;
create or replace function public.receive_purchase_order(p_purchase_order_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$ begin
  return public.receive_purchase_order_at(p_purchase_order_id,null);
end; $$;
create function public.cancel_purchase_order(p_purchase_order_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id=p_purchase_order_id for update;
  perform private.require_access(po.organization_id,po.outlet_id,array['owner','admin','manager']::public.app_role[]);
  if po.status not in ('draft','approved') then raise exception 'Only open PO can be cancelled' using errcode='22023'; end if;
  update public.purchase_orders set status='cancelled' where id=po.id;
end; $$;

create function public.save_recipe(p_organization_id uuid,p_recipe_id uuid,p_name text,p_output_variant_id uuid,p_yield_quantity numeric,
  p_output_unit_id uuid,p_kind text,p_items jsonb,p_archived boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare rec uuid; item record; qty numeric;
begin
  if not private.has_role(p_organization_id,array['owner','admin','manager','inventory_staff']::public.app_role[]) then raise exception 'Access denied' using errcode='42501'; end if;
  if p_kind not in ('menu','roasting') or p_kind is null or p_yield_quantity is null or p_yield_quantity<=0 or p_yield_quantity<>round(p_yield_quantity,4) then raise exception 'Invalid recipe' using errcode='22023'; end if;
  qty:=private.convert_quantity(p_organization_id,p_output_variant_id,p_output_unit_id,p_yield_quantity);
  if qty<=0 then raise exception 'Invalid yield' using errcode='22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Ingredient array required' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception '1-100 ingredients required' using errcode='22023'; end if;
  if p_recipe_id is null then
    insert into public.recipes(organization_id,name,output_variant_id,yield_quantity,output_unit_id,recipe_kind,archived_at)
      values(p_organization_id,p_name,p_output_variant_id,p_yield_quantity,p_output_unit_id,p_kind,case when p_archived then now() end) returning id into rec;
  else
    select id into rec from public.recipes where id=p_recipe_id and organization_id=p_organization_id for update;
    if rec is null then raise exception 'Recipe not found' using errcode='42501'; end if;
    update public.recipes set name=p_name,output_variant_id=p_output_variant_id,yield_quantity=p_yield_quantity,output_unit_id=p_output_unit_id,
      recipe_kind=p_kind,version=version+1,archived_at=case when p_archived then now() end where id=rec;
    delete from public.recipe_items where recipe_id=rec;
  end if;
  for item in select * from jsonb_to_recordset(p_items) as x(variant_id uuid,quantity numeric,unit_id uuid) loop
    qty:=private.convert_quantity(p_organization_id,item.variant_id,item.unit_id,item.quantity);
    if qty<=0 or item.quantity<>round(item.quantity,4) or item.variant_id=p_output_variant_id or not exists(select 1 from public.product_variants where id=item.variant_id and track_inventory and consumption_mode='stock' and archived_at is null) then
      raise exception 'Positive stocked ingredient distinct from output required' using errcode='22023'; end if;
    insert into public.recipe_items(organization_id,recipe_id,variant_id,quantity,unit_id) values(p_organization_id,rec,item.variant_id,item.quantity,item.unit_id);
  end loop;
  return rec;
end; $$;

create function private.recipe_snapshot(p_recipe uuid) returns jsonb language sql stable set search_path='' as $$
  select to_jsonb(r)||jsonb_build_object('ingredients',coalesce((select jsonb_agg(to_jsonb(i) order by i.variant_id) from public.recipe_items i where i.recipe_id=r.id),'[]'::jsonb))
  from public.recipes r where r.id=p_recipe;
$$;
-- Actual input quantities and actual yield are independent. The recipe version
-- and planned ingredient composition are snapshotted, never looked up for history.
create function public.run_production(p_organization_id uuid,p_outlet_id uuid,p_location_id uuid,p_recipe_id uuid,
  p_output_quantity numeric,p_output_unit_id uuid,p_inputs jsonb,p_notes text,p_request_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.recipes; rec uuid; op uuid; item record; qty numeric; out_qty numeric; cost numeric; total numeric:=0;
begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','manager','inventory_staff']::public.app_role[]);
  op:=private.start_inventory_operation(p_organization_id,p_outlet_id,p_request_key,'production',jsonb_build_object('location',p_location_id,'recipe',p_recipe_id,
    'quantity',p_output_quantity,'unit',p_output_unit_id,'inputs',p_inputs,'notes',p_notes));
  select (result->>'batch_id')::uuid into rec from public.inventory_operations where id=op;
  if rec is not null then return rec; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text,0));
  select * into r from public.recipes where id=p_recipe_id and organization_id=p_organization_id and archived_at is null for share;
  if r.id is null or not exists(select 1 from public.recipe_items where recipe_id=r.id) then raise exception 'Active nonempty recipe required' using errcode='22023'; end if;
  if not exists(select 1 from public.product_variants where id=r.output_variant_id and consumption_mode='stock' and track_inventory) then
    raise exception 'Batch output must use stock consumption mode' using errcode='22023'; end if;
  out_qty:=private.convert_quantity(p_organization_id,r.output_variant_id,p_output_unit_id,p_output_quantity);
  if out_qty<=0 then raise exception 'Positive actual yield required' using errcode='22023'; end if;
  if jsonb_typeof(p_inputs) is distinct from 'array' then raise exception 'Actual inputs required' using errcode='22023'; end if;
  if jsonb_array_length(p_inputs)<>(select count(*) from public.recipe_items where recipe_id=r.id) then raise exception 'Record actual quantity for every ingredient' using errcode='22023'; end if;
  if (select count(distinct x->>'variant_id') from jsonb_array_elements(p_inputs) x)<>jsonb_array_length(p_inputs) then raise exception 'Duplicate ingredient' using errcode='22023'; end if;
  insert into public.production_batches(organization_id,outlet_id,recipe_id,quantity,produced_by,batch_kind,recipe_snapshot,notes,operation_id,storage_location_id)
    values(p_organization_id,p_outlet_id,r.id,out_qty,auth.uid(),r.recipe_kind,private.recipe_snapshot(r.id),p_notes,op,p_location_id) returning id into rec;
  for item in select * from jsonb_to_recordset(p_inputs) as x(variant_id uuid,quantity numeric,unit_id uuid) order by variant_id loop
    if not exists(select 1 from public.recipe_items where recipe_id=r.id and variant_id=item.variant_id) then raise exception 'Unknown ingredient' using errcode='22023'; end if;
    qty:=private.convert_quantity(p_organization_id,item.variant_id,item.unit_id,item.quantity);
    if qty<=0 then raise exception 'Positive actual input required' using errcode='22023'; end if;
    cost:=private.apply_stock(p_organization_id,p_outlet_id,p_location_id,item.variant_id,-qty,'production_input',rec,'Actual production input',null,op);
    total:=total+cost;
    insert into public.production_inputs(organization_id,outlet_id,production_batch_id,variant_id,quantity,total_cost)
      values(p_organization_id,p_outlet_id,rec,item.variant_id,qty,cost);
  end loop;
  perform private.apply_stock(p_organization_id,p_outlet_id,p_location_id,r.output_variant_id,out_qty,'production_output',rec,'Actual production yield',total/out_qty,op);
  insert into public.production_outputs(organization_id,outlet_id,production_batch_id,variant_id,quantity,total_cost)
    values(p_organization_id,p_outlet_id,rec,r.output_variant_id,out_qty,total);
  update public.inventory_operations set result=jsonb_build_object('batch_id',rec,'cost',total) where id=op;
  return rec;
end; $$;
create or replace function public.produce_batch(p_organization_id uuid,p_outlet_id uuid,p_recipe_id uuid,p_quantity numeric) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.recipes; inputs jsonb;
begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','manager','inventory_staff']::public.app_role[]);
  select * into r from public.recipes where id=p_recipe_id and organization_id=p_organization_id for share;
  select jsonb_agg(jsonb_build_object('variant_id',variant_id,'quantity',quantity*p_quantity/r.yield_quantity,'unit_id',unit_id)) into inputs from public.recipe_items where recipe_id=r.id;
  return public.run_production(p_organization_id,p_outlet_id,null,p_recipe_id,p_quantity,r.output_unit_id,inputs,'Recipe yield (legacy RPC)',gen_random_uuid());
end; $$;

grant create on schema public,private to pos_writer;
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname='recipe_snapshot') or (n.nspname='public' and p.proname in
      ('create_purchase_order','receive_purchase_order_at','receive_purchase_order','cancel_purchase_order','save_recipe','run_production','produce_batch')) loop
    execute format('alter function %s owner to pos_writer',f.signature);
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.signature); end if;
  end loop;
end; $$;
revoke create on schema public,private from pos_writer;
do $$ begin execute format('revoke pos_identity,pos_writer,pos_auditor from %I',current_user); end; $$;
commit;
