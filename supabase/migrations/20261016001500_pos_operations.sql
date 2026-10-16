begin;
do $$ begin execute format('grant pos_identity,pos_writer,pos_auditor to %I with inherit true',current_user); end; $$;

-- Reuse the proven recipe/stock consumer, invoking it only on INSERT for legacy
-- receipts and on the one allowed final cost update for v2 held lines.
alter function private.prepare_sale_consumption() rename to consume_sale_line;
create function private.prepare_sale_consumption() returns trigger language plpgsql security definer set search_path='' as $$
declare v public.product_variants; r public.recipes; x record; plan jsonb:='[]'; qty numeric; snap jsonb;
begin
  select * into v from public.product_variants where id=new.variant_id and organization_id=new.organization_id for share;
  if not found or not v.is_active or v.archived_at is not null then raise exception 'Active variant required' using errcode='22023'; end if;
  new.sku_snapshot:=v.sku; new.variant_name:=v.name;
  if v.consumption_mode='recipe' then
    select * into r from public.recipes where id=v.sale_recipe_id and organization_id=new.organization_id and output_variant_id=v.id and archived_at is null for share;
    if r.id is null then raise exception 'Active recipe required' using errcode='22023'; end if;
    snap:=private.recipe_snapshot(r.id);
    for x in select * from public.recipe_items where recipe_id=r.id order by variant_id for share loop
      qty:=private.convert_quantity(new.organization_id,x.variant_id,x.unit_id,x.quantity)*new.quantity*v.sale_quantity/private.convert_quantity(new.organization_id,v.id,r.output_unit_id,r.yield_quantity);
      if qty<=0 or qty<>round(qty,4) then raise exception 'Recipe precision exceeded' using errcode='22023'; end if;
      plan:=plan||jsonb_build_array(jsonb_build_object('variant_id',x.variant_id,'quantity',qty));
    end loop;
    if jsonb_array_length(plan)=0 then raise exception 'Recipe has no ingredients' using errcode='22023'; end if;
  elsif v.consumption_mode='stock' then
    plan:=jsonb_build_array(jsonb_build_object('variant_id',v.id,'quantity',new.quantity*v.sale_quantity));
  end if;
  new.consumption_plan:=jsonb_build_object('mode',v.consumption_mode,'sale_quantity',v.sale_quantity,'recipe',snap,'items',plan,'catalog_cost',v.acquisition_cost*new.quantity*v.sale_quantity);
  new.cost_total:=0; new.recipe_snapshot:=jsonb_build_object('consumptions',jsonb_build_array()); return new;
end; $$;
drop trigger prepare_sale_consumption on public.order_items;
create trigger prepare_sale_consumption before insert on public.order_items for each row when (new.consumption_plan is null) execute function private.prepare_sale_consumption();
-- Legacy INSERT still consumes immediately. v2 uses the saved plan at completion.
create function private.consume_legacy_line() returns trigger language plpgsql security definer set search_path='' as $$
declare x record; cost numeric; total numeric:=0; consumed jsonb:='[]';
begin
  if exists(select 1 from public.orders where id=new.order_id and pos_version=2) then return new; end if;
  for x in select * from jsonb_to_recordset(new.consumption_plan->'items') as t(variant_id uuid,quantity numeric) order by variant_id loop
    cost:=private.apply_stock(new.organization_id,new.outlet_id,null,x.variant_id,-x.quantity,'sale',new.order_id,'POS sale'); total:=total+cost;
    consumed:=consumed||jsonb_build_array(jsonb_build_object('variant_id',x.variant_id,'quantity',x.quantity,'total_cost',cost));
  end loop;
  new.cost_total:=case when jsonb_array_length(consumed)=0 then (new.consumption_plan->>'catalog_cost')::numeric else total end;
  new.recipe_snapshot:=new.consumption_plan||jsonb_build_object('consumptions',consumed); return new;
end; $$;
create trigger z_consume_legacy_line before insert on public.order_items for each row execute function private.consume_legacy_line();

-- Only this exact cost update is allowed while the parent v2 order is pending.
drop trigger append_only on public.order_items;
grant update(cost_total,recipe_snapshot) on public.order_items to pos_writer;
create policy internal_cost_update on public.order_items for update to pos_writer using(true) with check(true);
create function private.guard_pos_line() returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op='UPDATE' and current_user='pos_writer' and old.cost_total=0 and
    (to_jsonb(new)-'cost_total'-'recipe_snapshot'-'updated_at')=(to_jsonb(old)-'cost_total'-'recipe_snapshot'-'updated_at') and
    exists(select 1 from public.orders where id=old.order_id and pos_version=2 and status in ('held','pending')) then return new; end if;
  raise exception 'Append-only order line' using errcode='42501';
end; $$;
create trigger append_only before update or delete on public.order_items for each row execute function private.guard_pos_line();

create function private.pos_journal(p_org uuid,p_outlet uuid,p_key uuid,p_description text,p_debit_code text,p_credit_code text,p_amount numeric) returns void
language plpgsql set search_path='' as $$ declare e uuid; d uuid; c uuid; begin
  if p_amount=0 then return; end if;
  select id into d from public.financial_accounts where organization_id=p_org and code=p_debit_code and archived_at is null;
  select id into c from public.financial_accounts where organization_id=p_org and code=p_credit_code and archived_at is null;
  if d is null or c is null then raise exception 'Accounting configuration missing' using errcode='23514'; end if;
  insert into public.journal_entries(organization_id,outlet_id,description,idempotency_key,posted_by) values(p_org,p_outlet,p_description,p_key,auth.uid()) returning id into e;
  insert into public.journal_lines(organization_id,journal_entry_id,financial_account_id,debit,credit) values(p_org,e,d,p_amount,0),(p_org,e,c,0,p_amount);
end; $$;

create function private.complete_pos_order(p_order uuid) returns void language plpgsql set search_path='' as $$
declare o public.orders; line public.order_items; x record; cost numeric; total numeric; consumed jsonb; collected numeric;
begin
  select * into o from public.orders where id=p_order for update;
  if o.status='completed' then return; end if;
  select coalesce(sum(amount),0) into collected from public.payments where order_id=o.id;
  if collected<>o.total then raise exception 'Order is not fully paid' using errcode='23514'; end if;
  for line in select * from public.order_items where order_id=o.id order by id loop
    consumed:='[]'; total:=0;
    for x in select * from jsonb_to_recordset(line.consumption_plan->'items') as t(variant_id uuid,quantity numeric) order by variant_id loop
      cost:=private.apply_stock(o.organization_id,o.outlet_id,null,x.variant_id,-x.quantity,'sale',o.id,'POS finalized sale'); total:=total+cost;
      consumed:=consumed||jsonb_build_array(jsonb_build_object('variant_id',x.variant_id,'quantity',x.quantity,'total_cost',cost));
    end loop;
    update public.order_items set cost_total=case when jsonb_array_length(consumed)=0 then (line.consumption_plan->>'catalog_cost')::numeric else total end,
      recipe_snapshot=line.consumption_plan||jsonb_build_object('consumptions',consumed) where id=line.id;
    insert into public.order_item_consumptions(organization_id,outlet_id,order_item_id,variant_id,quantity,total_cost)
      select o.organization_id,o.outlet_id,line.id,c.variant_id,c.quantity,c.total_cost from jsonb_to_recordset(consumed) as c(variant_id uuid,quantity numeric,total_cost numeric);
  end loop;
  perform private.pos_journal(o.organization_id,o.outlet_id,o.id,'POS revenue','2100-POS','4000',o.total-o.tax);
  if o.tax>0 then perform private.pos_journal(o.organization_id,o.outlet_id,gen_random_uuid(),'POS sales tax','2100-POS','2200-POS',o.tax); end if;
  update public.orders set status='completed',payment_status='paid',finalized_at=now(),revision=revision+1 where id=o.id;
end; $$;

create function public.hold_order(p_organization_id uuid,p_outlet_id uuid,p_shift_id uuid,p_idempotency_key uuid,p_items jsonb,p_customer_id uuid default null,p_promotion_code text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare rec uuid; existing public.orders; v record; item record; promo public.promotions; subtotal numeric:=0; discount numeric:=0; tax numeric; rate numeric; payload jsonb; snap jsonb;
begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','manager','cashier']::public.app_role[]);
  if p_idempotency_key is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Request key and items required' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception '1-100 items required' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or (x-'variant_id'-'quantity'-'note')<>'{}'::jsonb or not(x?'variant_id' and x?'quantity') or jsonb_typeof(x->'variant_id')<>'string' or jsonb_typeof(x->'quantity')<>'number' or (x?'note' and jsonb_typeof(x->'note')<>'string')) then raise exception 'Invalid order item payload' using errcode='22023'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(quantity numeric,note text) where quantity is null or quantity<=0 or quantity>100000 or quantity<>round(quantity,4) or quantity::text in ('NaN','Infinity','-Infinity') or length(note)>500) then raise exception 'Invalid quantity or note' using errcode='22023'; end if;
  payload:=jsonb_build_object('items',p_items,'shift',p_shift_id,'customer',p_customer_id,'promotion',p_promotion_code);
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text,0));
  select * into existing from public.orders where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.outlet_id<>p_outlet_id or existing.cashier_id<>auth.uid() or existing.request_payload<>payload then raise exception 'Idempotency conflict' using errcode='22023'; end if; return existing.id;
  end if;
  perform 1 from public.cashier_shifts where id=p_shift_id and organization_id=p_organization_id and outlet_id=p_outlet_id and cashier_id=auth.uid() and closed_at is null for update;
  if not found then raise exception 'Own open shift required' using errcode='42501'; end if;
  if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id and organization_id=p_organization_id and archived_at is null) then raise exception 'Invalid customer' using errcode='22023'; end if;
  if p_promotion_code is not null then
    select * into promo from public.promotions where organization_id=p_organization_id and outlet_id=p_outlet_id and code=p_promotion_code and archived_at is null and now()>=starts_at and now()<ends_at;
    if not found then raise exception 'Invalid promotion' using errcode='22023'; end if;
  end if;
  for item in select * from jsonb_to_recordset(p_items) as x(variant_id uuid,quantity numeric,note text) order by variant_id loop
    select pv.*,p.name product_name into v from public.product_variants pv join public.products p on p.id=pv.product_id and p.organization_id=pv.organization_id where pv.id=item.variant_id and pv.organization_id=p_organization_id and pv.is_active and p.is_active and pv.archived_at is null and p.archived_at is null for share of pv,p;
    if not found then raise exception 'Invalid variant' using errcode='22023'; end if;
    subtotal:=subtotal+round(v.price*item.quantity,2);
  end loop;
  select pos_tax_percent into rate from public.outlets where id=p_outlet_id and organization_id=p_organization_id;
  discount:=round(subtotal*coalesce(promo.discount_percent,0)/100,2); tax:=round((subtotal-discount)*rate/100,2);
  snap:=jsonb_build_object('tax_percent',rate,'promotion_code',promo.code,'discount_percent',coalesce(promo.discount_percent,0));
  rec:=gen_random_uuid();
  insert into public.orders(id,organization_id,outlet_id,customer_id,cashier_shift_id,cashier_id,idempotency_key,request_payload,status,payment_status,subtotal,discount,total,tax,tax_percent,promotion_id,pos_version,pricing_snapshot,receipt_number,receipt_snapshot)
    values(rec,p_organization_id,p_outlet_id,p_customer_id,p_shift_id,auth.uid(),p_idempotency_key,payload,'held','pending',subtotal,discount,subtotal-discount+tax,tax,rate,promo.id,2,snap,'POS-'||replace(rec::text,'-',''),jsonb_build_object('organization',(select name from public.organizations where id=p_organization_id),'outlet',(select name from public.outlets where id=p_outlet_id),'customer',(select name from public.customers where id=p_customer_id),'footer',(select value from public.application_settings where organization_id=p_organization_id and key='receipt_footer')));
  for item in select * from jsonb_to_recordset(p_items) as x(variant_id uuid,quantity numeric,note text) order by variant_id loop
    select pv.*,p.name product_name into v from public.product_variants pv join public.products p on p.id=pv.product_id where pv.id=item.variant_id and pv.organization_id=p_organization_id;
    insert into public.order_items(organization_id,outlet_id,order_id,variant_id,product_name,quantity,unit_price,line_total,note)
      values(p_organization_id,p_outlet_id,rec,v.id,v.product_name,item.quantity,v.price,round(item.quantity*v.price,2),coalesce(item.note,''));
  end loop;
  return rec;
end; $$;

create function public.add_payment_attempt(p_order_id uuid,p_cash_account_id uuid,p_idempotency_key uuid,p_method text,p_amount numeric,p_tendered_amount numeric default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare o public.orders; a public.pos_payment_attempts; account_kind text; paid numeric; reserved numeric; tender numeric; shift_account uuid;
begin
  select * into o from public.orders where id=p_order_id;
  perform private.require_access(o.organization_id,o.outlet_id,array['owner','admin','manager','cashier']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended(o.outlet_id::text,0));
  select * into o from public.orders where id=p_order_id for update;
  tender:=coalesce(p_tendered_amount,p_amount);
  select * into a from public.pos_payment_attempts where organization_id=o.organization_id and idempotency_key=p_idempotency_key;
  if found then
    if a.order_id is distinct from o.id or a.requested_by is distinct from auth.uid() or a.cash_account_id is distinct from p_cash_account_id or a.method is distinct from p_method or a.amount is distinct from p_amount or a.tendered_amount is distinct from tender then raise exception 'Idempotency conflict' using errcode='22023'; end if; return a.id;
  end if;
  if o.pos_version<>2 or o.status not in ('held','pending') or o.payment_status in ('refunded','partially_refunded') then raise exception 'Order is not payable' using errcode='22023'; end if;
  if o.cashier_id<>auth.uid() and not private.can_access(o.organization_id,o.outlet_id,array['owner','admin','manager']::public.app_role[]) then raise exception 'Cannot pay another cashier order' using errcode='42501'; end if;
  select cash_account_id into shift_account from public.cashier_shifts where organization_id=o.organization_id and outlet_id=o.outlet_id and cashier_id=auth.uid() and closed_at is null for update;
  if shift_account is null then raise exception 'Own open shift required' using errcode='42501'; end if;
  select kind into account_kind from public.cash_accounts where id=p_cash_account_id and organization_id=o.organization_id and outlet_id=o.outlet_id and archived_at is null;
  if not found or (p_method='cash' and (account_kind<>'cash' or p_cash_account_id<>shift_account)) or (p_method in ('transfer','card') and account_kind<>'bank') or (p_method='qris' and account_kind not in ('bank','ewallet')) then raise exception 'Payment account/method mismatch' using errcode='22023'; end if;
  if p_method is null or p_method not in ('cash','transfer','qris','card') or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) or tender<p_amount or tender<>round(tender,2) or tender::text in ('NaN','Infinity','-Infinity') or (p_method<>'cash' and tender<>p_amount) then raise exception 'Invalid payment or tender' using errcode='22023'; end if;
  select coalesce(sum(amount),0) into paid from public.payments where order_id=o.id;
  select coalesce(sum(amount),0) into reserved from public.pos_payment_attempts where order_id=o.id and status='pending';
  if paid+reserved+p_amount>o.total then raise exception 'Payment exceeds unallocated total' using errcode='22023'; end if;
  insert into public.pos_payment_attempts(organization_id,outlet_id,order_id,cash_account_id,idempotency_key,method,amount,tendered_amount,status,requested_by,resolved_by,resolution_note,resolved_at)
    values(o.organization_id,o.outlet_id,o.id,p_cash_account_id,p_idempotency_key,p_method,p_amount,tender,case when p_method='cash' then 'paid' else 'pending' end,auth.uid(),case when p_method='cash' then auth.uid() end,case when p_method='cash' then 'Cash counted at register' end,case when p_method='cash' then now() end) returning * into a;
  if p_method='cash' then
    insert into public.payments(organization_id,outlet_id,order_id,cash_account_id,amount,method,received_by,tendered_amount,change_amount,attempt_id) values(o.organization_id,o.outlet_id,o.id,p_cash_account_id,p_amount,'cash',auth.uid(),tender,tender-p_amount,a.id);
    insert into public.cash_movements(organization_id,outlet_id,cash_account_id,amount,reason,reference_id,actor_id) values(o.organization_id,o.outlet_id,p_cash_account_id,p_amount,'pos_collection',a.id,auth.uid());
    perform private.pos_journal(o.organization_id,o.outlet_id,a.id,'POS cash collection','1000','2100-POS',p_amount);
    if paid+p_amount=o.total then perform private.complete_pos_order(o.id); else update public.orders set status='pending',payment_status='partial',revision=revision+1 where id=o.id; end if;
  else update public.orders set status='pending',payment_status=case when paid>0 then 'partial' else 'pending' end,revision=revision+1 where id=o.id; end if;
  return a.id;
end; $$;

create function public.resolve_payment_attempt(p_attempt_id uuid,p_status text,p_settlement_reference text default null,p_note text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.pos_payment_attempts; o public.orders; paid numeric; refunded numeric;
begin
  select * into a from public.pos_payment_attempts where id=p_attempt_id;
  perform private.require_access(a.organization_id,a.outlet_id,array['owner','admin','manager','finance_staff']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended(a.outlet_id::text,0));
  select * into o from public.orders where id=a.order_id for update; select * into a from public.pos_payment_attempts where id=p_attempt_id for update;
  if a.status<>'pending' then
    if a.status is distinct from p_status or a.settlement_reference is distinct from p_settlement_reference or a.resolution_note is distinct from p_note then raise exception 'Resolution conflicts with recorded result' using errcode='22023'; end if; return a.id;
  end if;
  if p_status is null or p_status not in ('paid','failed') or length(trim(coalesce(p_note,'')))<3 then raise exception 'Resolution status/note required' using errcode='22023'; end if;
  if p_status='paid' and length(trim(coalesce(p_settlement_reference,'')))<3 then raise exception 'Verified settlement reference required' using errcode='22023'; end if;
  if o.status not in ('held','pending') then raise exception 'Order is no longer payable' using errcode='22023'; end if;
  update public.pos_payment_attempts set status=p_status,resolved_by=auth.uid(),settlement_reference=p_settlement_reference,resolution_note=p_note,resolved_at=now() where id=a.id;
  select coalesce(sum(amount),0) into paid from public.payments where order_id=o.id;
  select coalesce(sum(amount),0) into refunded from public.refunds where order_id=o.id;
  if p_status='failed' then update public.orders set payment_status=case when refunded>0 then case when refunded=paid then 'refunded' else 'partially_refunded' end when paid>0 then 'partial' when exists(select 1 from public.pos_payment_attempts where order_id=o.id and status='pending') then 'pending' else 'failed' end,revision=revision+1 where id=o.id; return a.id; end if;
  insert into public.payments(organization_id,outlet_id,order_id,cash_account_id,amount,method,received_by,tendered_amount,change_amount,attempt_id) values(a.organization_id,a.outlet_id,a.order_id,a.cash_account_id,a.amount,a.method,auth.uid(),a.amount,0,a.id);
  insert into public.cash_movements(organization_id,outlet_id,cash_account_id,amount,reason,reference_id,actor_id) values(a.organization_id,a.outlet_id,a.cash_account_id,a.amount,'pos_collection',a.id,auth.uid());
  perform private.pos_journal(a.organization_id,a.outlet_id,a.id,'POS verified settlement','1000','2100-POS',a.amount);
  -- External settlement is a fact separate from fulfillment. Persist it even if
  -- the remaining stock was sold meanwhile; completion is a separate atomic RPC.
  update public.orders set status='pending',payment_status=case when refunded>0 then case when refunded=paid+a.amount then 'refunded' else 'partially_refunded' end when paid+a.amount=o.total then 'paid' else 'partial' end,revision=revision+1 where id=o.id;
  return a.id;
end; $$;

create function public.finalize_pos_order(p_order_id uuid,p_payments jsonb,p_idempotency_key uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare o public.orders; part record; payment_key uuid; payload jsonb; op uuid;
begin
  select * into o from public.orders where id=p_order_id;
  perform private.require_access(o.organization_id,o.outlet_id,array['owner','admin','manager','cashier']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended(o.outlet_id::text,0));
  if jsonb_typeof(p_payments) is distinct from 'array' or p_idempotency_key is null then raise exception 'Payment array and key required' using errcode='22023'; end if;
  if jsonb_array_length(p_payments)>10 then raise exception 'Maximum 10 payment parts' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_payments) x where jsonb_typeof(x)<>'object' or (x-'cash_account_id'-'method'-'amount'-'tendered_amount')<>'{}'::jsonb or not(x?'cash_account_id' and x?'method' and x?'amount') or jsonb_typeof(x->'amount')<>'number') then raise exception 'Invalid payment payload' using errcode='22023'; end if;
  payload:=jsonb_build_object('order',o.id,'payments',p_payments);
  op:=private.start_inventory_operation(o.organization_id,o.outlet_id,p_idempotency_key,'pos_finalize',payload);
  if exists(select 1 from public.inventory_operations where id=op and result<>'{}'::jsonb) then return o.id; end if;
  select * into o from public.orders where id=p_order_id for update;
  if o.cashier_id<>auth.uid() and not private.can_access(o.organization_id,o.outlet_id,array['owner','admin','manager']::public.app_role[]) then raise exception 'Cannot finalize another cashier order' using errcode='42501'; end if;
  perform 1 from public.cashier_shifts where organization_id=o.organization_id and outlet_id=o.outlet_id and cashier_id=auth.uid() and closed_at is null for update;
  if not found then raise exception 'Own open shift required' using errcode='42501'; end if;
  if o.pos_version<>2 or o.status not in ('held','pending') then raise exception 'Order is not payable' using errcode='22023'; end if;
  if exists(select 1 from public.refunds where order_id=o.id) then raise exception 'Refunded order cannot be finalized' using errcode='22023'; end if;
  if o.total=0 and jsonb_array_length(p_payments)>0 then raise exception 'Zero-total order requires empty payments' using errcode='22023'; end if;
  if o.total=0 or (jsonb_array_length(p_payments)=0 and (select coalesce(sum(amount),0) from public.payments where order_id=o.id)=o.total) then perform private.complete_pos_order(o.id); else
    if jsonb_array_length(p_payments)=0 then raise exception 'Payment allocation required' using errcode='22023'; end if;
    for part in select value,n from jsonb_array_elements(p_payments) with ordinality t(value,n) loop
      payment_key:=md5(p_idempotency_key::text||':'||part.n::text)::uuid;
      perform public.add_payment_attempt(o.id,(part.value->>'cash_account_id')::uuid,payment_key,part.value->>'method',(part.value->>'amount')::numeric,(part.value->>'tendered_amount')::numeric);
    end loop;
  end if;
  update public.inventory_operations set result=jsonb_build_object('order',o.id) where id=op;
  return o.id;
end; $$;

create function public.void_order(p_order_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$ declare o public.orders; begin
  select * into o from public.orders where id=p_order_id;
  perform private.require_access(o.organization_id,o.outlet_id,array['owner','admin','manager']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended(o.outlet_id::text,0)); select * into o from public.orders where id=p_order_id for update;
  if o.status='voided' and o.void_reason=p_reason and o.voided_by=auth.uid() then return; end if;
  if o.pos_version<>2 or o.status not in ('held','pending') or
    (select coalesce(sum(amount),0) from public.payments where order_id=o.id)>(select coalesce(sum(amount),0) from public.refunds where order_id=o.id)
    or exists(select 1 from public.pos_payment_attempts where order_id=o.id and status='pending') then raise exception 'Refund received funds and resolve pending attempts before voiding' using errcode='22023'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Void reason required' using errcode='22023'; end if;
  update public.orders set status='voided',payment_status=case when exists(select 1 from public.refunds where order_id=o.id) then 'refunded' else 'failed' end,void_reason=p_reason,voided_by=auth.uid(),revision=revision+1 where id=o.id;
end; $$;

grant create on schema public,private to pos_writer;
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
    (n.nspname='public' and p.proname in ('hold_order','add_payment_attempt','resolve_payment_attempt','finalize_pos_order','void_order')) or
    (n.nspname='private' and p.proname in ('prepare_sale_consumption','consume_legacy_line','guard_pos_line','pos_journal','complete_pos_order')) loop
    execute format('alter function %s owner to pos_writer',f.signature); execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.signature::text like 'hold_order(%' or f.signature::text like 'add_payment_attempt(%' or f.signature::text like 'resolve_payment_attempt(%' or f.signature::text like 'finalize_pos_order(%' or f.signature::text like 'void_order(%' then execute format('grant execute on function %s to authenticated',f.signature); end if;
  end loop;
end $$;
revoke create on schema public,private from pos_writer;
do $$ begin execute format('revoke pos_identity,pos_writer,pos_auditor from %I',current_user); end; $$;
commit;
