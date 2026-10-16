begin;
do $$ begin execute format('grant pos_identity, pos_writer, pos_auditor to %I with inherit true', current_user); end; $$;
-- Temporary installer policies permit backfill under FORCE RLS, including on
-- populated databases installed by a non-superuser. Removed before commit.
do $$ declare t text; begin
  foreach t in array array['units','outlets','inventory_balances'] loop
    execute format('create policy inventory_migration on public.%I to %I using (true) with check (true)',t,current_user);
  end loop;
end; $$;

alter table public.units add column dimension text not null default 'custom'
  check (dimension in ('mass','volume','count','custom'));
alter table public.units add column factor_to_base numeric(18,6) not null default 1
  check (factor_to_base > 0 and factor_to_base::text not in ('NaN','Infinity','-Infinity'));
create function private.normalize_unit() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.code <> old.code or new.dimension <> old.dimension or new.factor_to_base <> old.factor_to_base) then
    raise exception 'Create a new unit instead of changing a conversion' using errcode = '23514';
  end if;
  case lower(new.code)
    when 'g' then new.dimension := 'mass'; new.factor_to_base := 1;
    when 'kg' then new.dimension := 'mass'; new.factor_to_base := 1000;
    when 'ml' then new.dimension := 'volume'; new.factor_to_base := 1;
    when 'l' then new.dimension := 'volume'; new.factor_to_base := 1000;
    when 'pc','pcs' then new.dimension := 'count'; new.factor_to_base := 1;
    else null;
  end case;
  return new;
end;
$$;
-- Normalize existing unit rows before freezing conversion metadata.
update public.units set dimension = case when lower(code) in ('g','kg') then 'mass'
  when lower(code) in ('ml','l') then 'volume' when lower(code) in ('pc','pcs') then 'count' else 'custom' end,
  factor_to_base = case when lower(code) in ('kg','l') then 1000 else 1 end;
create trigger normalize_unit before insert or update on public.units for each row execute function private.normalize_unit();

alter table public.products add column photo_url text check (photo_url is null or (photo_url ~ '^https://' and length(photo_url) <= 2048));
alter table public.products add column is_active boolean not null default true;
alter table public.product_variants add column barcode text check (length(barcode) between 1 and 80);
alter table public.product_variants add column acquisition_cost numeric(18,6) not null default 0 check (acquisition_cost >= 0 and acquisition_cost::text <> 'NaN');
alter table public.product_variants add column sale_quantity numeric(18,4) not null default 1 check (sale_quantity > 0 and sale_quantity::text <> 'NaN');
alter table public.product_variants add column is_active boolean not null default true;
alter table public.product_variants add column consumption_mode text not null default 'stock' check (consumption_mode in ('stock','recipe','none'));
alter table public.product_variants add column sale_recipe_id uuid;
alter table public.product_variants add foreign key (organization_id, sale_recipe_id) references public.recipes(organization_id,id);
create unique index product_variants_barcode_idx on public.product_variants(organization_id,barcode) where barcode is not null;
create index products_search_idx on public.products(organization_id,lower(name),id);
create index product_variants_recipe_idx on public.product_variants(organization_id,sale_recipe_id);

create table public.storage_locations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), outlet_id uuid not null,
  code text not null check (length(trim(code)) between 1 and 40), name text not null check (length(trim(name)) between 1 and 160),
  is_default boolean not null default false, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,outlet_id,id), unique (organization_id,outlet_id,code),
  foreign key (organization_id,outlet_id) references public.outlets(organization_id,id),
  check (not is_default or archived_at is null)
);
create unique index storage_default_idx on public.storage_locations(outlet_id) where is_default;
create table public.inventory_location_balances (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), outlet_id uuid not null,
  storage_location_id uuid not null, variant_id uuid not null,
  quantity numeric(18,4) not null default 0 check (quantity >= 0 and quantity::text <> 'NaN'),
  inventory_value numeric(24,6) not null default 0 check (inventory_value >= 0 and inventory_value::text <> 'NaN'),
  revision bigint not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), unique (storage_location_id,variant_id),
  foreign key (organization_id,outlet_id,storage_location_id) references public.storage_locations(organization_id,outlet_id,id),
  foreign key (organization_id,variant_id) references public.product_variants(organization_id,id)
);
create table public.inventory_operations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), outlet_id uuid not null,
  kind text not null, request_key uuid not null, payload jsonb not null, result jsonb not null default '{}'::jsonb,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,request_key),
  foreign key (organization_id,outlet_id) references public.outlets(organization_id,id)
);
alter table public.inventory_balances add column inventory_value numeric(24,6) not null default 0 check (inventory_value >= 0 and inventory_value::text <> 'NaN');
alter table public.inventory_balances add column minimum_stock numeric(18,4) not null default 0 check (minimum_stock >= 0 and minimum_stock::text <> 'NaN');
alter table public.inventory_movements drop constraint inventory_movements_reason_check;
alter table public.inventory_movements add constraint inventory_movements_reason_check
  check (reason in ('adjustment','sale','receipt','production_input','production_output','waste','incoming','outgoing','transfer_in','transfer_out','stocktake'));
alter table public.inventory_movements add column storage_location_id uuid;
alter table public.inventory_movements add column operation_id uuid;
alter table public.inventory_movements add column unit_cost numeric(18,6) check (unit_cost >= 0 and unit_cost::text <> 'NaN');
alter table public.inventory_movements add column total_cost numeric(24,6) check (total_cost::text <> 'NaN');
alter table public.inventory_movements add column balance_after numeric(18,4);
alter table public.inventory_movements add column location_balance_after numeric(18,4);
alter table public.inventory_movements add foreign key (organization_id,outlet_id,storage_location_id) references public.storage_locations(organization_id,outlet_id,id);
alter table public.inventory_movements add foreign key (organization_id,operation_id) references public.inventory_operations(organization_id,id);
create index inventory_movements_operation_idx on public.inventory_movements(organization_id,operation_id);
create index inventory_movements_location_idx on public.inventory_movements(organization_id,outlet_id,storage_location_id,created_at desc,id);

alter table public.recipes add column recipe_kind text not null default 'menu' check (recipe_kind in ('menu','roasting'));
alter table public.recipes add column version integer not null default 1 check (version > 0);
alter table public.recipes add column output_unit_id uuid;
alter table public.recipes add foreign key (organization_id,output_unit_id) references public.units(organization_id,id);
alter table public.recipe_items add column unit_id uuid;
alter table public.recipe_items add foreign key (organization_id,unit_id) references public.units(organization_id,id);
alter table public.purchase_order_items add column unit_id uuid;
alter table public.purchase_order_items add foreign key (organization_id,unit_id) references public.units(organization_id,id);
alter table public.goods_receipts add column storage_location_id uuid;
alter table public.goods_receipts add foreign key (organization_id,outlet_id,storage_location_id) references public.storage_locations(organization_id,outlet_id,id);
alter table public.goods_receipt_items add column unit_cost numeric(18,6);
alter table public.goods_receipt_items add column canonical_quantity numeric(18,4);
alter table public.production_batches add column batch_kind text not null default 'menu' check (batch_kind in ('menu','roasting'));
alter table public.production_batches add column recipe_snapshot jsonb;
alter table public.production_batches add column notes text;
alter table public.production_batches add column operation_id uuid;
alter table public.production_batches add column storage_location_id uuid;
alter table public.production_batches add foreign key (organization_id,operation_id) references public.inventory_operations(organization_id,id);
alter table public.production_batches add foreign key (organization_id,outlet_id,storage_location_id) references public.storage_locations(organization_id,outlet_id,id);
alter table public.production_inputs add column total_cost numeric(24,6);
alter table public.production_outputs add column total_cost numeric(24,6);
alter table public.order_items add column cost_total numeric(24,6);
alter table public.order_items add column recipe_snapshot jsonb;
create table public.order_item_consumptions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), outlet_id uuid not null,
  order_item_id uuid not null, variant_id uuid not null, quantity numeric(18,4) not null check (quantity > 0 and quantity::text <> 'NaN'),
  total_cost numeric(24,6) not null check (total_cost >= 0 and total_cost::text <> 'NaN'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), unique (order_item_id,variant_id),
  foreign key (organization_id,order_item_id) references public.order_items(organization_id,id),
  foreign key (organization_id,variant_id) references public.product_variants(organization_id,id),
  foreign key (organization_id,outlet_id) references public.outlets(organization_id,id)
);

create or replace function private.pos_tables() returns text[] language sql immutable set search_path = '' as $$
  select array['organizations','profiles','organization_members','outlets','categories','products','product_variants',
    'units','suppliers','inventory_balances','inventory_movements','purchase_orders','purchase_order_items',
    'goods_receipts','goods_receipt_items','recipes','recipe_items','production_batches','production_inputs','production_outputs',
    'waste_records','customers','promotions','orders','order_items','payments','refunds','cashier_shifts','cash_accounts',
    'cash_movements','expenses','expense_categories','financial_accounts','journal_entries','journal_lines','assets',
    'loans','loan_payments','audit_logs','application_settings','storage_locations','inventory_location_balances',
    'inventory_operations','order_item_consumptions']::text[];
$$;
do $$ declare t text; begin
  foreach t in array array['storage_locations','inventory_location_balances','inventory_operations','order_item_consumptions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated,pos_writer',t);
    execute format('grant insert on public.%I to pos_writer',t);
    execute format('create policy internal_read on public.%I for select to pos_writer using (true)',t);
    execute format('create policy internal_insert on public.%I for insert to pos_writer with check (true)',t);
    execute format('create policy tenant_read on public.%I for select to authenticated using (private.can_access(organization_id,outlet_id,array[''owner'',''admin'',''manager'',''inventory_staff'',''finance_staff'']::public.app_role[]))',t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
  end loop;
end; $$;
grant update on public.storage_locations,public.inventory_location_balances,public.inventory_operations to pos_writer;
do $$ declare t text; begin
  foreach t in array array['storage_locations','inventory_location_balances'] loop
    execute format('create policy inventory_migration on public.%I to %I using (true) with check (true)',t,current_user);
  end loop;
end; $$;
create policy internal_update on public.storage_locations for update to pos_writer using (true) with check (true);
create policy internal_update on public.inventory_location_balances for update to pos_writer using (true) with check (true);
create policy internal_update on public.inventory_operations for update to pos_writer using (true) with check (true);
create trigger append_only before update or delete on public.order_item_consumptions for each row execute function private.reject_mutation();
grant select on public.storage_locations to pos_identity;
create policy identity_read on public.storage_locations for select to pos_identity using (true);
grant insert,update on public.storage_locations to authenticated;
create policy tenant_insert on public.storage_locations for insert to authenticated with check (private.can_access(organization_id,outlet_id,array['owner','admin','manager','inventory_staff']::public.app_role[]) and not is_default);
create policy tenant_update on public.storage_locations for update to authenticated using (private.can_access(organization_id,outlet_id,array['owner','admin','manager','inventory_staff']::public.app_role[])) with check (private.can_access(organization_id,outlet_id,array['owner','admin','manager','inventory_staff']::public.app_role[]));

create function private.initialize_location() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.storage_locations(organization_id,outlet_id,code,name,is_default) values(new.organization_id,new.id,'MAIN','Penyimpanan utama',true);
  return new;
end; $$;
grant create on schema private to pos_writer;
alter function private.initialize_location() owner to pos_writer;
revoke create on schema private from pos_writer;
create trigger initialize_location after insert on public.outlets for each row execute function private.initialize_location();
insert into public.storage_locations(organization_id,outlet_id,code,name,is_default)
  select organization_id,id,'MAIN','Penyimpanan utama',true from public.outlets;
-- Carry existing stock into the primary location. No historical movements are
-- fabricated and no historical cost is guessed: legacy value starts at zero.
insert into public.inventory_location_balances(organization_id,outlet_id,storage_location_id,variant_id,quantity)
  select b.organization_id,b.outlet_id,l.id,b.variant_id,b.quantity from public.inventory_balances b
  join public.storage_locations l on l.outlet_id=b.outlet_id and l.is_default;

create function private.guard_stock_identity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'storage_locations' then
    if new.is_default is distinct from old.is_default then raise exception 'Primary location is fixed' using errcode='23514'; end if;
    if new.archived_at is not null and exists(select 1 from public.inventory_location_balances where storage_location_id=old.id and quantity>0) then
      raise exception 'Transfer remaining stock before archiving location' using errcode='23514'; end if;
  elsif new.unit_id <> old.unit_id and exists(select 1 from public.inventory_movements where variant_id=old.id) then
    raise exception 'Stock unit cannot change after a movement' using errcode='23514';
  end if;
  return new;
end; $$;
grant create on schema private to pos_writer;
alter function private.guard_stock_identity() owner to pos_writer;
revoke create on schema private from pos_writer;
create trigger guard_stock_identity before update on public.storage_locations for each row execute function private.guard_stock_identity();
create trigger guard_stock_identity before update on public.product_variants for each row execute function private.guard_stock_identity();

-- Cover new FK access paths, including nullable legacy-compatible columns.
create index location_balances_scope_idx on public.inventory_location_balances(organization_id,outlet_id,variant_id);
create index location_balances_variant_idx on public.inventory_location_balances(organization_id,variant_id);
create index operations_scope_idx on public.inventory_operations(organization_id,outlet_id,created_at desc);
create index operations_actor_idx on public.inventory_operations(actor_id);
create index consumptions_scope_idx on public.order_item_consumptions(organization_id,outlet_id,order_item_id);
create index consumptions_variant_idx on public.order_item_consumptions(organization_id,variant_id);
revoke all on function private.normalize_unit(),private.initialize_location(),private.guard_stock_identity() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['units','outlets','inventory_balances','storage_locations','inventory_location_balances'] loop
    execute format('drop policy inventory_migration on public.%I',t);
  end loop;
end; $$;
do $$ begin execute format('revoke pos_identity,pos_writer,pos_auditor from %I',current_user); end; $$;
commit;
