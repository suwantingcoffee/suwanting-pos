begin;
do $$ begin execute format('grant pos_identity,pos_writer,pos_auditor to %I with inherit true',current_user); end; $$;
grant insert,update on public.products,public.product_variants to pos_writer;
create policy internal_insert on public.products for insert to pos_writer with check(true);
create policy internal_update_catalog on public.products for update to pos_writer using(true) with check(true);
create policy internal_insert on public.product_variants for insert to pos_writer with check(true);
create policy internal_update_catalog on public.product_variants for update to pos_writer using(true) with check(true);

create function public.save_product(p_organization_id uuid,p_product_id uuid,p_name text,p_category_id uuid,p_description text,
  p_photo_url text,p_is_active boolean,p_variants jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare rec uuid; v record; vid uuid; retained uuid[]:='{}';
begin
  if not private.has_role(p_organization_id,array['owner','admin','manager','inventory_staff']::public.app_role[]) then raise exception 'Access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_variants) is distinct from 'array' then raise exception 'Variants array required' using errcode='22023'; end if;
  if jsonb_array_length(p_variants) not between 1 and 100 then raise exception '1-100 variants required' using errcode='22023'; end if;
  if p_product_id is null then
    insert into public.products(organization_id,name,category_id,description,photo_url,is_active)
      values(p_organization_id,p_name,p_category_id,p_description,p_photo_url,p_is_active) returning id into rec;
  else
    select id into rec from public.products where id=p_product_id and organization_id=p_organization_id and archived_at is null for update;
    if rec is null then raise exception 'Product not found' using errcode='42501'; end if;
    update public.products set name=p_name,category_id=p_category_id,description=p_description,photo_url=p_photo_url,is_active=p_is_active where id=rec;
  end if;
  if exists(select 1 from jsonb_array_elements(p_variants) x where x->>'id' is not null group by x->>'id' having count(*)>1) then raise exception 'Duplicate variant' using errcode='22023'; end if;
  for v in select * from jsonb_to_recordset(p_variants) as x(id uuid,name text,sku text,barcode text,unit_id uuid,price numeric,acquisition_cost numeric,
    sale_quantity numeric,is_active boolean,consumption_mode text,sale_recipe_id uuid) loop
    if v.price<>round(v.price,2) or v.sale_quantity<>round(v.sale_quantity,4) or v.acquisition_cost<>round(v.acquisition_cost,6) then raise exception 'Invalid numeric precision' using errcode='22023'; end if;
    if not exists(select 1 from public.units where id=v.unit_id and organization_id=p_organization_id and archived_at is null) then raise exception 'Active unit required' using errcode='22023'; end if;
    if v.id is null then
      if coalesce(v.consumption_mode,'stock')='recipe' then raise exception 'Save variant, create recipe, then enable recipe consumption' using errcode='22023'; end if;
      insert into public.product_variants(organization_id,product_id,name,sku,barcode,unit_id,price,acquisition_cost,sale_quantity,is_active,consumption_mode,track_inventory)
        values(p_organization_id,rec,v.name,v.sku,nullif(v.barcode,''),v.unit_id,v.price,coalesce(v.acquisition_cost,0),coalesce(v.sale_quantity,1),coalesce(v.is_active,true),
          coalesce(v.consumption_mode,'stock'),coalesce(v.consumption_mode,'stock')='stock') returning id into vid;
    else
      select id into vid from public.product_variants where id=v.id and organization_id=p_organization_id and product_id=rec for update;
      if vid is null then raise exception 'Variant belongs to another product' using errcode='42501'; end if;
      update public.product_variants set name=v.name,sku=v.sku,barcode=nullif(v.barcode,''),unit_id=v.unit_id,price=v.price,acquisition_cost=coalesce(v.acquisition_cost,0),
        sale_quantity=coalesce(v.sale_quantity,1),is_active=coalesce(v.is_active,true),consumption_mode=coalesce(v.consumption_mode,'stock'),
        track_inventory=coalesce(v.consumption_mode,'stock')='stock',sale_recipe_id=v.sale_recipe_id,archived_at=null where id=vid;
    end if;
    retained:=array_append(retained,vid);
  end loop;
  -- Omitted variants are archived with history retained. Guard rejects remaining stock.
  update public.product_variants set archived_at=now() where product_id=rec and archived_at is null
    and not(id=any(retained));
  return rec;
end; $$;
-- Archiving is the user-facing delete operation; historical references stay valid.
create function public.archive_product(p_product_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.products;
begin
  select * into p from public.products where id=p_product_id for update;
  if not private.has_role(p.organization_id,array['owner','admin','manager','inventory_staff']::public.app_role[]) then raise exception 'Access denied' using errcode='42501'; end if;
  update public.product_variants set archived_at=now() where product_id=p.id and archived_at is null;
  update public.products set archived_at=now() where id=p.id;
end; $$;
create function private.guard_product_stock() returns trigger language plpgsql security definer set search_path='' as $$ begin
  if (new.archived_at is distinct from old.archived_at or new.is_active is distinct from old.is_active)
    and exists(select 1 from public.inventory_balances b join public.product_variants v on v.id=b.variant_id where v.product_id=old.id and b.quantity>0) then
    raise exception 'Clear product stock before archiving/deactivating' using errcode='23514'; end if;
  return new;
end; $$;
create trigger guard_product_stock before update on public.products for each row execute function private.guard_product_stock();

-- Complete FK indexes and finite-number checks for added columns/tables.
do $$ declare c record; begin
  for c in select table_name,column_name from information_schema.columns where table_schema='public'
    and table_name=any(private.pos_tables()) and data_type='numeric'
    and not exists(select 1 from pg_constraint where conname=table_name||'_'||column_name||'_finite') loop
    execute format('alter table public.%I add constraint %I check (%I::text not in (''NaN'',''Infinity'',''-Infinity''))',c.table_name,c.table_name||'_'||c.column_name||'_finite',c.column_name);
  end loop;
end; $$;
grant create on schema public,private to pos_writer;
alter function public.save_product(uuid,uuid,text,uuid,text,text,boolean,jsonb) owner to pos_writer;
alter function public.archive_product(uuid) owner to pos_writer;
alter function private.guard_product_stock() owner to pos_writer;
revoke create on schema public,private from pos_writer;
revoke all on function public.save_product(uuid,uuid,text,uuid,text,text,boolean,jsonb),public.archive_product(uuid),private.guard_product_stock() from public,anon,authenticated;
grant execute on function public.save_product(uuid,uuid,text,uuid,text,text,boolean,jsonb),public.archive_product(uuid) to authenticated;
do $$ begin execute format('revoke pos_identity,pos_writer,pos_auditor from %I',current_user); end; $$;
commit;
