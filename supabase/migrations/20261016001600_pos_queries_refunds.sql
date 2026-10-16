begin;
do $$ begin execute format('grant pos_identity,pos_writer,pos_auditor to %I with inherit true',current_user); end; $$;

create function public.pos_catalog(p_organization_id uuid,p_outlet_id uuid,p_search text default '',p_category_id uuid default null,p_page integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$ declare result jsonb; begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','manager','cashier','finance_staff']::public.app_role[]);
  if p_page is null or p_page<1 or p_page>100000 then raise exception 'Invalid page' using errcode='22023'; end if;
  with catalog as (
    select v.id,v.product_id,p.name product_name,v.name variant_name,v.sku,v.price,p.photo_url,v.sale_quantity,v.consumption_mode,
      case when v.consumption_mode='none' then null when v.consumption_mode='recipe' then
        (select floor(min(coalesce(b.quantity,0)/nullif(private.convert_quantity(p_organization_id,i.variant_id,i.unit_id,i.quantity)*v.sale_quantity/private.convert_quantity(p_organization_id,v.id,r.output_unit_id,r.yield_quantity),0)))
          from public.recipes r join public.recipe_items i on i.recipe_id=r.id
          left join public.inventory_location_balances b on b.variant_id=i.variant_id and b.storage_location_id=l.id
          where r.id=v.sale_recipe_id and r.archived_at is null)
      else floor(coalesce(b.quantity,0)/v.sale_quantity) end available
    from public.product_variants v join public.products p on p.id=v.product_id and p.organization_id=v.organization_id
    left join public.storage_locations l on l.outlet_id=p_outlet_id and l.organization_id=p_organization_id and l.is_default and l.archived_at is null
    left join public.inventory_location_balances b on b.storage_location_id=l.id and b.variant_id=v.id
    where v.organization_id=p_organization_id and v.is_active and p.is_active and v.archived_at is null and p.archived_at is null
      and (p_category_id is null or p.category_id=p_category_id)
      and position(lower(coalesce(p_search,'')) in lower(p.name||' '||v.name||' '||v.sku||' '||coalesce(v.barcode,'')))>0
  ), paged as (select * from catalog order by product_name,variant_name,id offset (p_page-1)*24 limit 24)
  select jsonb_build_object('count',(select count(*) from catalog),'rows',coalesce((select jsonb_agg(to_jsonb(p) order by product_name,variant_name,id) from paged p),'[]'::jsonb)) into result;
  return result;
end; $$;

-- Retain the old cash API for integrations/receipts, but close its shortcut
-- around electronic verification and the trusted outlet tax configuration.
alter function public.checkout(uuid,uuid,uuid,uuid,jsonb,uuid,uuid,text) set schema private;
alter function private.checkout(uuid,uuid,uuid,uuid,jsonb,uuid,uuid,text) rename to checkout_legacy;
revoke all on function private.checkout_legacy(uuid,uuid,uuid,uuid,jsonb,uuid,uuid,text) from public,anon,authenticated;
create function public.checkout(p_organization_id uuid,p_outlet_id uuid,p_shift_id uuid,p_idempotency_key uuid,p_items jsonb,p_cash_account_id uuid,p_customer_id uuid default null,p_promotion_code text default null) returns uuid
language plpgsql security definer set search_path='' as $$ declare existing public.orders; begin
  perform private.require_access(p_organization_id,p_outlet_id,array['owner','admin','manager','cashier']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended(p_outlet_id::text,0));
  select * into existing from public.orders where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if existing.pos_version<>1 then raise exception 'Use v2 order lifecycle' using errcode='22023'; end if;
    return private.checkout_legacy(p_organization_id,p_outlet_id,p_shift_id,p_idempotency_key,p_items,p_cash_account_id,p_customer_id,p_promotion_code);
  end if;
  if not exists(select 1 from public.cash_accounts where id=p_cash_account_id and organization_id=p_organization_id and outlet_id=p_outlet_id and kind='cash' and archived_at is null)
    or not exists(select 1 from public.outlets where id=p_outlet_id and organization_id=p_organization_id and pos_tax_percent=0) then
    raise exception 'Legacy checkout supports only zero-tax cash; use hold_order/finalize_pos_order' using errcode='22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Items array required' using errcode='22023'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) x(variant_id uuid) join public.product_variants v on v.id=x.variant_id and v.organization_id=p_organization_id join public.products p on p.id=v.product_id where not p.is_active or not v.is_active) then raise exception 'Active product required' using errcode='22023'; end if;
  return private.checkout_legacy(p_organization_id,p_outlet_id,p_shift_id,p_idempotency_key,p_items,p_cash_account_id,p_customer_id,p_promotion_code);
end; $$;

-- Resume is an audited lifecycle change, using an optimistic revision. Payments
-- preserve the original snapshots and are never re-applied on resume.
create function public.resume_order(p_order_id uuid,p_shift_id uuid,p_expected_revision integer) returns uuid language plpgsql security definer set search_path='' as $$ declare o public.orders; begin
  select * into o from public.orders where id=p_order_id;
  perform private.require_access(o.organization_id,o.outlet_id,array['owner','admin','manager','cashier']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended(o.outlet_id::text,0)); select * into o from public.orders where id=p_order_id for update;
  if o.pos_version<>2 or o.status not in ('held','pending') or o.revision is distinct from p_expected_revision then raise exception 'Order changed; reload before resume' using errcode='40001'; end if;
  if o.cashier_id<>auth.uid() and not private.can_access(o.organization_id,o.outlet_id,array['owner','admin','manager']::public.app_role[]) then raise exception 'Cannot take another cashier order' using errcode='42501'; end if;
  perform 1 from public.cashier_shifts where id=p_shift_id and organization_id=o.organization_id and outlet_id=o.outlet_id and cashier_id=auth.uid() and closed_at is null for update;
  if not found then raise exception 'Own open shift required' using errcode='42501'; end if;
  update public.orders set status='pending',revision=revision+1 where id=o.id; return o.id;
end; $$;

create function public.refund_pos_payment(p_payment_id uuid,p_amount numeric,p_reason text,p_idempotency_key uuid,p_settlement_reference text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.payments; o public.orders; r public.refunds; refunded numeric; tax_refunded numeric; tax_part numeric:=0; order_refunded numeric; paid numeric; rec uuid;
begin
  select * into p from public.payments where id=p_payment_id;
  perform private.require_access(p.organization_id,p.outlet_id,array['owner','admin','manager','finance_staff']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended(p.outlet_id::text,0)); select * into o from public.orders where id=p.order_id for update;
  select * into r from public.refunds where organization_id=o.organization_id and idempotency_key=p_idempotency_key;
  if found then
    if r.payment_id is distinct from p_payment_id or r.amount is distinct from p_amount or r.reason is distinct from p_reason or r.approved_by is distinct from auth.uid() or r.settlement_reference is distinct from p_settlement_reference then raise exception 'Idempotency conflict' using errcode='22023'; end if; return r.id;
  end if;
  select coalesce(sum(amount),0) into refunded from public.refunds where payment_id=p.id;
  if o.pos_version<>2 or p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2) or refunded+p_amount>p.amount or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Invalid refund amount/reason' using errcode='22023'; end if;
  if p.method<>'cash' and length(trim(coalesce(p_settlement_reference,'')))<3 then raise exception 'Verified refund settlement reference required' using errcode='22023'; end if;
  select coalesce(sum(amount),0),coalesce(sum(tax_amount),0) into order_refunded,tax_refunded from public.refunds where order_id=o.id;
  if o.status='completed' and o.total>0 then
    -- Cumulative rounding makes a final full refund reverse exactly the tax.
    tax_part:=round((order_refunded+p_amount)*o.tax/o.total,2)-tax_refunded;
  end if;
  insert into public.refunds(organization_id,outlet_id,order_id,payment_id,amount,reason,approved_by,idempotency_key,tax_amount,settlement_reference)
    values(o.organization_id,o.outlet_id,o.id,p.id,p_amount,p_reason,auth.uid(),p_idempotency_key,tax_part,p_settlement_reference) returning id into rec;
  insert into public.cash_movements(organization_id,outlet_id,cash_account_id,amount,reason,reference_id,actor_id)
    values(o.organization_id,o.outlet_id,p.cash_account_id,-p_amount,'pos_refund',rec,auth.uid());
  if o.status='completed' then
    perform private.pos_journal(o.organization_id,o.outlet_id,rec,'POS sales refund','4000','1000',p_amount-tax_part);
    if tax_part>0 then perform private.pos_journal(o.organization_id,o.outlet_id,gen_random_uuid(),'POS tax refund','2200-POS','1000',tax_part); end if;
  else perform private.pos_journal(o.organization_id,o.outlet_id,rec,'POS deposit refund','2100-POS','1000',p_amount); end if;
  select coalesce(sum(amount),0) into paid from public.payments where order_id=o.id;
  update public.orders set payment_status=case when order_refunded+p_amount=paid then 'refunded' else 'partially_refunded' end,revision=revision+1 where id=o.id;
  return rec;
end; $$;

-- Legacy refund retains its historical API and status semantics. It cannot
-- guess which part of a v2 split payment should be refunded.
alter function public.refund_order(uuid,numeric,text,uuid) set schema private;
alter function private.refund_order(uuid,numeric,text,uuid) rename to refund_legacy_order;
revoke all on function private.refund_legacy_order(uuid,numeric,text,uuid) from public,anon,authenticated;
create function public.refund_order(p_order_id uuid,p_amount numeric,p_reason text,p_idempotency_key uuid) returns uuid language plpgsql security definer set search_path='' as $$ declare rec uuid; o public.orders; begin
  select * into o from public.orders where id=p_order_id;
  perform private.require_access(o.organization_id,o.outlet_id,array['owner','admin','manager','finance_staff']::public.app_role[]);
  if o.pos_version=2 then raise exception 'Select original payment for a split refund' using errcode='22023'; end if;
  rec:=private.refund_legacy_order(p_order_id,p_amount,p_reason,p_idempotency_key);
  update public.orders set payment_status=status where id=p_order_id; return rec;
end; $$;

-- Frozen final orders and terminal attempts cannot be rewritten, even through
-- a future accidental grant to the internal writer.
create function private.guard_pos_order() returns trigger language plpgsql set search_path='' as $$ begin
  if old.pos_version=2 and ((old.status in ('completed','voided') and
    (to_jsonb(new)-'payment_status'-'revision'-'updated_at')<>(to_jsonb(old)-'payment_status'-'revision'-'updated_at')) or
    new.subtotal<>old.subtotal or new.discount<>old.discount or new.tax<>old.tax or new.total<>old.total or new.request_payload<>old.request_payload or new.receipt_snapshot<>old.receipt_snapshot or new.pricing_snapshot<>old.pricing_snapshot or new.receipt_number<>old.receipt_number) then raise exception 'Order financial snapshot is immutable' using errcode='42501'; end if; return new;
end; $$;
create trigger guard_pos_order before update on public.orders for each row execute function private.guard_pos_order();
create function private.guard_payment_attempt() returns trigger language plpgsql set search_path='' as $$ begin
  if tg_op='DELETE' then raise exception 'Payment attempts cannot be deleted' using errcode='42501'; end if;
  if old.status<>'pending' or (to_jsonb(new)-'status'-'resolved_by'-'settlement_reference'-'resolution_note'-'resolved_at'-'updated_at')<>(to_jsonb(old)-'status'-'resolved_by'-'settlement_reference'-'resolution_note'-'resolved_at'-'updated_at') then raise exception 'Payment request is immutable' using errcode='42501'; end if; return new;
end; $$;
create trigger guard_payment_attempt before update or delete on public.pos_payment_attempts for each row execute function private.guard_payment_attempt();

grant create on schema public,private to pos_writer;
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
    (n.nspname='public' and p.proname in ('pos_catalog','checkout','resume_order','refund_pos_payment','refund_order')) or
    (n.nspname='private' and p.proname in ('guard_pos_order','guard_payment_attempt')) loop
    execute format('alter function %s owner to pos_writer',f.signature); execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.signature); end if;
  end loop;
end $$;
revoke create on schema public,private from pos_writer;
do $$ begin execute format('revoke pos_identity,pos_writer,pos_auditor from %I',current_user); end; $$;
commit;
