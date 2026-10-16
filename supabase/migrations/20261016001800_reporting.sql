begin;
do $$ begin execute format('grant pos_identity,pos_writer,pos_auditor to %I with inherit true',current_user); end; $$;

create function public.analytics_report(
  p_organization_id uuid,
  p_from date,
  p_until date,
  p_outlet_ids uuid[] default null,
  p_product_id uuid default null,
  p_category_id uuid default null,
  p_payment_method text default null,
  p_grain text default 'day'
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare accessible uuid[]; selected uuid[]; result jsonb;
begin
  perform private.require_access(p_organization_id,null,array['owner','admin','manager','finance_staff']::public.app_role[]);
  if p_from is null or p_until is null or p_until<=p_from or p_until-p_from>3660 or
    p_grain not in ('day','week','month') or
    (p_payment_method is not null and p_payment_method not in ('cash','bank','ewallet','transfer','qris','card')) then
    raise exception 'Invalid report filters' using errcode='22023';
  end if;
  select coalesce(array_agg(o.id order by o.id),'{}'::uuid[]) into accessible
    from public.outlets o
    where o.organization_id=p_organization_id
      and private.can_access(p_organization_id,o.id,array['owner','admin','manager','finance_staff']::public.app_role[]);
  if p_outlet_ids is null then selected:=accessible;
  else
    if cardinality(p_outlet_ids)=0 or cardinality(p_outlet_ids)<>(select count(distinct x)::integer from unnest(p_outlet_ids) q(x)) or
      not p_outlet_ids <@ accessible then raise exception 'Invalid or unauthorized outlet filter' using errcode='42501'; end if;
    selected:=p_outlet_ids;
  end if;
  if cardinality(selected)=0 then raise exception 'No accessible outlets' using errcode='42501'; end if;
  if p_product_id is not null and not exists(select 1 from public.product_variants where organization_id=p_organization_id and id=p_product_id) then
    raise exception 'Invalid product filter' using errcode='22023'; end if;
  if p_category_id is not null and not exists(select 1 from public.categories where organization_id=p_organization_id and id=p_category_id) then
    raise exception 'Invalid category filter' using errcode='22023'; end if;

  with selected_outlets as (
    select o.id,o.name from public.outlets o where o.organization_id=p_organization_id and o.id=any(selected)
  ), orders_in_range as (
    select o.* from public.orders o
    where o.organization_id=p_organization_id and o.outlet_id=any(selected) and o.status='completed'
      and o.finalized_at>=p_from::timestamptz and o.finalized_at<p_until::timestamptz
      and (p_payment_method is null or exists(select 1 from public.payments pm where pm.order_id=o.id and pm.method=p_payment_method))
      and exists(
        select 1 from public.order_items oi
        join public.product_variants pv on pv.id=oi.variant_id and pv.organization_id=oi.organization_id
        join public.products pr on pr.id=pv.product_id and pr.organization_id=pv.organization_id
        where oi.order_id=o.id and (p_product_id is null or oi.variant_id=p_product_id)
          and (p_category_id is null or pr.category_id=p_category_id)
      )
  ), all_order_lines as (
    select oi.organization_id,oi.outlet_id,oi.order_id,oi.id,oi.variant_id,oi.product_name,oi.sku_snapshot,
      oi.variant_name,oi.quantity,oi.line_total,coalesce(oi.cost_total,0) cost_total,o.subtotal,o.discount,o.tax,o.total,
      o.finalized_at,o.receipt_number,o.cashier_id,o.payment_status,
      pv.product_id,pr.category_id,coalesce(pr.name,oi.product_name) product_label,
      coalesce(cat.name,'Tanpa kategori') category_label,
      case when o.subtotal=0 then 0 else oi.line_total*(o.subtotal-o.discount)/o.subtotal end net_line_before_refund
    from orders_in_range o
    join public.order_items oi on oi.order_id=o.id and oi.organization_id=o.organization_id
    join public.product_variants pv on pv.id=oi.variant_id and pv.organization_id=oi.organization_id
    join public.products pr on pr.id=pv.product_id and pr.organization_id=pv.organization_id
    left join public.categories cat on cat.id=pr.category_id and cat.organization_id=pr.organization_id
  ), matching_lines as (
    select l.* from all_order_lines l
    where (p_product_id is null or l.variant_id=p_product_id)
      and (p_category_id is null or l.category_id=p_category_id)
  ), refund_events as (
    select r.id,r.order_id,r.outlet_id,r.amount,r.tax_amount,r.created_at
    from public.refunds r
    join public.orders o on o.id=r.order_id and o.organization_id=r.organization_id
    where r.organization_id=p_organization_id and r.outlet_id=any(selected)
      and r.created_at>=p_from::timestamptz and r.created_at<p_until::timestamptz
      and (p_payment_method is null or exists(select 1 from public.payments pm where pm.id=r.payment_id and pm.method=p_payment_method))
      and (p_product_id is null or exists(select 1 from public.order_items oi where oi.order_id=o.id and oi.variant_id=p_product_id))
      and (p_category_id is null or exists(select 1 from public.order_items oi join public.product_variants pv on pv.id=oi.variant_id
        join public.products pr on pr.id=pv.product_id where oi.order_id=o.id and pr.category_id=p_category_id))
  ), refund_by_order as (
    select order_id,sum(amount-tax_amount) refund_net,sum(amount) refund_gross,sum(tax_amount) refund_tax
    from refund_events group by order_id
  ), refund_allocation as (
    select r.order_id,
      sum(r.refund_net*share.selected_net/nullif(o.subtotal-o.discount,0)) refund_net,
      sum(r.refund_gross*share.selected_net/nullif(o.subtotal-o.discount,0)) refund_gross,
      sum(r.refund_tax*share.selected_net/nullif(o.subtotal-o.discount,0)) refund_tax
    from refund_by_order r join public.orders o on o.id=r.order_id
    join lateral (
      select sum(case when o.subtotal=0 then 0 else oi.line_total*(o.subtotal-o.discount)/o.subtotal end) selected_net
      from public.order_items oi join public.product_variants pv on pv.id=oi.variant_id
      join public.products pr on pr.id=pv.product_id
      where oi.order_id=o.id and (p_product_id is null or oi.variant_id=p_product_id)
        and (p_category_id is null or pr.category_id=p_category_id)
    ) share on share.selected_net is not null
    group by r.order_id
  ), line_values as (
    select l.*,
      case when l.subtotal=0 then 0 else round(l.line_total*l.discount/l.subtotal,2) end allocated_discount,
      case when l.subtotal-l.discount<=0 then 0 else coalesce(r.refund_net,0)*l.net_line_before_refund/(l.subtotal-l.discount) end allocated_refund
    from matching_lines l left join refund_allocation r on r.order_id=l.order_id
  ), sales_summary as (
    select coalesce(sum(line_total),0) gross_sales,
      coalesce(sum(allocated_discount),0) discounts,
      coalesce(sum(net_line_before_refund),0) net_sales,
      coalesce(sum(cost_total),0) cogs,
      count(distinct order_id)::integer transactions,
      coalesce(sum(tax),0) sales_tax
    from line_values
  ), refund_summary as (
    select coalesce(sum(refund_gross),0) refunded,coalesce(sum(refund_tax),0) refunded_tax,
      coalesce(sum(refund_net),0) refunded_net from refund_allocation
  ), expense_summary as (
    select coalesce(sum(e.amount),0) operating_expenses
    from public.expenses e where e.organization_id=p_organization_id and e.outlet_id=any(selected)
      and e.incurred_on>=p_from and e.incurred_on<p_until
  ), other_income_summary as (
    select coalesce(sum(i.amount),0) other_income from public.income_records i
    where i.organization_id=p_organization_id and i.outlet_id=any(selected) and i.received_on>=p_from and i.received_on<p_until
  ), loan_expense_summary as (
    select coalesce(sum(lp.interest_amount),0) interest,coalesce(sum(lp.fee_amount),0) fees
    from public.loan_payments lp where lp.organization_id=p_organization_id and lp.outlet_id=any(selected)
      and lp.paid_on>=p_from and lp.paid_on<p_until
  ), waste_summary as (
    select coalesce(sum(abs(im.total_cost)),0) waste_cost
    from public.inventory_movements im where im.organization_id=p_organization_id and im.outlet_id=any(selected)
      and im.reason='waste' and im.created_at>=p_from::timestamptz and im.created_at<p_until::timestamptz
      and (p_product_id is null or im.variant_id=p_product_id)
      and (p_category_id is null or exists(select 1 from public.product_variants pv join public.products pr
        on pr.id=pv.product_id where pv.id=im.variant_id and pr.category_id=p_category_id))
  ), cash_shortage_summary as (
    select coalesce(sum(l.debit-l.credit),0) shortage
    from public.journal_lines l join public.journal_entries e on e.id=l.journal_entry_id
    join public.financial_accounts a on a.id=l.financial_account_id
    where e.organization_id=p_organization_id and e.outlet_id=any(selected) and e.entry_date>=p_from and e.entry_date<p_until
      and a.code='5100'
  ), daily as (
    select date_trunc(p_grain,l.finalized_at)::date bucket,
      coalesce(sum(l.line_total),0) gross_sales,
      coalesce(sum(l.net_line_before_refund-l.allocated_refund),0) net_sales,
      count(distinct l.order_id)::integer transactions
    from line_values l group by date_trunc(p_grain,l.finalized_at)::date
  ), line_products as (
    select l.variant_id,l.sku_snapshot,l.variant_name,l.product_label,l.category_label,
      sum(l.quantity) quantity,sum(l.line_total) gross_sales,sum(l.allocated_discount) discounts,
      sum(l.net_line_before_refund-l.allocated_refund) net_sales,sum(l.cost_total) cogs
    from line_values l group by l.variant_id,l.sku_snapshot,l.variant_name,l.product_label,l.category_label
  ), category_sales as (
    select l.category_id,l.category_label,sum(l.quantity) quantity,sum(l.line_total) gross_sales,
      sum(l.allocated_discount) discounts,sum(l.net_line_before_refund-l.allocated_refund) net_sales,
      sum(l.cost_total) cogs
    from line_values l group by l.category_id,l.category_label
  ), cash_summary as (
    select coalesce(sum(greatest(m.amount,0)),0) cash_in,coalesce(sum(greatest(-m.amount,0)),0) cash_out
    from public.cash_movements m where m.organization_id=p_organization_id and m.outlet_id=any(selected)
      and m.created_at>=p_from::timestamptz and m.created_at<p_until::timestamptz
  ), account_summary as (
    select a.id,a.name,a.kind,a.outlet_id,
      coalesce(sum(m.amount) filter(where m.created_at<p_until::timestamptz),0) balance
    from public.cash_accounts a left join public.cash_movements m
      on m.cash_account_id=a.id and m.organization_id=a.organization_id and m.outlet_id=a.outlet_id
    where a.organization_id=p_organization_id and a.outlet_id=any(selected)
    group by a.id,a.name,a.kind,a.outlet_id
  ), outlet_sales as (
    select s.id outlet_id,s.name outlet_name,count(distinct l.order_id)::integer transactions,
      coalesce(sum(l.line_total),0) gross_sales,coalesce(sum(l.net_line_before_refund-l.allocated_refund),0) net_sales,
      coalesce(sum(l.cost_total),0) cogs
    from selected_outlets s left join line_values l on l.outlet_id=s.id
    group by s.id,s.name
  ), payment_summary as (
    select pm.method,coalesce(sum(pm.amount),0) received,count(distinct pm.order_id)::integer transactions
    from public.payments pm join orders_in_range o on o.id=pm.order_id
    where (p_payment_method is null or pm.method=p_payment_method)
    group by pm.method
  ), expense_rows as (
    select e.id,e.incurred_on,e.description,e.amount,ec.name category,a.name account
    from public.expenses e left join public.expense_categories ec on ec.id=e.expense_category_id
    left join public.cash_accounts a on a.id=e.cash_account_id
    where e.organization_id=p_organization_id and e.outlet_id=any(selected) and e.incurred_on>=p_from and e.incurred_on<p_until
  ), movements as (
    select im.id,im.created_at,im.outlet_id,im.variant_id,coalesce(pv.sku,'') sku,coalesce(p.name,'') product,
      im.reason,im.quantity,im.note
    from public.inventory_movements im join public.product_variants pv on pv.id=im.variant_id and pv.organization_id=im.organization_id
    join public.products p on p.id=pv.product_id and p.organization_id=pv.organization_id
    where im.organization_id=p_organization_id and im.outlet_id=any(selected)
      and im.created_at>=p_from::timestamptz and im.created_at<p_until::timestamptz
      and (p_product_id is null or im.variant_id=p_product_id)
      and (p_category_id is null or p.category_id=p_category_id)
  ), valuation as (
    select pv.id variant_id,pv.sku,p.name product,pv.name variant,sum(b.quantity) quantity,
      sum(b.inventory_value) inventory_value,sum(b.minimum_stock) minimum_stock
    from public.inventory_balances b join public.product_variants pv on pv.id=b.variant_id and pv.organization_id=b.organization_id
    join public.products p on p.id=pv.product_id and p.organization_id=pv.organization_id
    where b.organization_id=p_organization_id and b.outlet_id=any(selected)
      and (p_product_id is null or pv.id=p_product_id)
      and (p_category_id is null or p.category_id=p_category_id)
    group by pv.id,pv.sku,p.name,pv.name
  ), waste as (
    select w.id,w.created_at,w.outlet_id,pv.sku,p.name product,pv.name variant,w.quantity,w.reason
    from public.waste_records w join public.product_variants pv on pv.id=w.variant_id
    join public.products p on p.id=pv.product_id
    where w.organization_id=p_organization_id and w.outlet_id=any(selected)
      and w.created_at>=p_from::timestamptz and w.created_at<p_until::timestamptz
      and (p_product_id is null or w.variant_id=p_product_id)
      and (p_category_id is null or p.category_id=p_category_id)
  ), production as (
    select b.id,b.produced_at,b.outlet_id,b.batch_kind,b.quantity output_quantity,
      coalesce(sum(po.total_cost),0) output_cost,
      coalesce((select sum(pi.quantity) from public.production_inputs pi where pi.production_batch_id=b.id),0) input_quantity
    from public.production_batches b left join public.production_outputs po on po.production_batch_id=b.id
    where b.organization_id=p_organization_id and b.outlet_id=any(selected)
      and b.produced_at>=p_from::timestamptz and b.produced_at<p_until::timestamptz
      and (p_product_id is null or exists(select 1 from public.production_outputs x where x.production_batch_id=b.id and x.variant_id=p_product_id))
      and (p_category_id is null or exists(select 1 from public.production_outputs x join public.product_variants pv on pv.id=x.variant_id
        join public.products p on p.id=pv.product_id where x.production_batch_id=b.id and p.category_id=p_category_id))
    group by b.id,b.produced_at,b.outlet_id,b.batch_kind,b.quantity
  ), payment_reconciliation as (
    select a.method,a.status,count(*)::integer attempts,coalesce(sum(a.amount),0) amount
    from public.pos_payment_attempts a where a.organization_id=p_organization_id and a.outlet_id=any(selected)
      and a.created_at>=p_from::timestamptz and a.created_at<p_until::timestamptz
      and (p_payment_method is null or a.method=p_payment_method)
      and (p_product_id is null or exists(select 1 from public.order_items oi where oi.order_id=a.order_id and oi.variant_id=p_product_id))
      and (p_category_id is null or exists(select 1 from public.order_items oi join public.product_variants pv on pv.id=oi.variant_id
        join public.products p on p.id=pv.product_id where oi.order_id=a.order_id and p.category_id=p_category_id))
    group by a.method,a.status
  ), order_costs as (
    select order_id,sum(cost_total) cogs from matching_lines group by order_id
  ), cashier_performance as (
    select o.cashier_id,coalesce(nullif(p.full_name,''),o.cashier_id::text) cashier_name,
      count(*)::integer transactions,sum(o.total) total_sales,avg(o.total) average_transaction,
      coalesce(sum(oc.cogs),0) cogs
    from orders_in_range o left join public.profiles p on p.id=o.cashier_id
    left join order_costs oc on oc.order_id=o.id group by o.cashier_id,p.full_name
  ), recent as (
    select o.id,o.receipt_number,o.finalized_at,o.outlet_id,s.name outlet_name,
      o.total,o.payment_status,o.cashier_id,coalesce(nullif(p.full_name,''),o.cashier_id::text) cashier_name
    from orders_in_range o join selected_outlets s on s.id=o.outlet_id
    left join public.profiles p on p.id=o.cashier_id
    order by o.finalized_at desc,o.id limit 25
  ), low_stock as (
    select v.* from valuation v where v.quantity<=v.minimum_stock order by v.quantity,v.product,v.variant limit 20
  ), inventory_totals as (
    select coalesce(sum(quantity),0) quantity,coalesce(sum(inventory_value),0) value from valuation
  )
  select jsonb_build_object(
    'filters',jsonb_build_object('from',p_from,'until',p_until,'outlet_ids',selected,'product_id',p_product_id,
      'category_id',p_category_id,'payment_method',p_payment_method,'grain',p_grain),
    'sales',jsonb_build_object(
      'gross_sales',s.gross_sales,'discounts',s.discounts,'refunds',r.refunded,'refund_tax',r.refunded_tax,
      'net_sales',s.net_sales-r.refunded_net,'sales_tax',s.sales_tax,'transactions',s.transactions,
      'average_transaction',case when s.transactions=0 then 0 else (s.net_sales-r.refunded_net)/s.transactions end,
      'cogs',s.cogs,'gross_profit',s.net_sales-r.refunded_net-s.cogs),
    'profit_loss',jsonb_build_object('net_sales',s.net_sales-r.refunded_net,'cogs',s.cogs,
      'gross_profit',s.net_sales-r.refunded_net-s.cogs,'other_income',oi.other_income,
      'operating_expenses',ex.operating_expenses,'interest_expense',le.interest,'loan_fees',le.fees,
      'waste_cost',ws.waste_cost,'cash_shortage',css.shortage,
      'net_profit',s.net_sales-r.refunded_net-s.cogs+oi.other_income-ex.operating_expenses-le.interest-le.fees-ws.waste_cost-css.shortage),
    'cashflow',(select jsonb_build_object('cash_in',cash_in,'cash_out',cash_out,'net_cashflow',cash_in-cash_out) from cash_summary),
    'series',coalesce((select jsonb_agg(jsonb_build_object('period',g.bucket,'gross_sales',coalesce(d.gross_sales,0),
      'net_sales',coalesce(d.net_sales,0),'transactions',coalesce(d.transactions,0))
      order by g.bucket) from generate_series(date_trunc(p_grain,p_from::timestamp),
        date_trunc(p_grain,(p_until-1)::timestamp),case p_grain when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end) g(bucket)
      left join daily d on d.bucket=g.bucket::date),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(to_jsonb(x) order by x.net_sales desc,x.product_label) from
      (select variant_id,sku_snapshot sku,variant_name variant,product_label,category_label,quantity,gross_sales,discounts,
        net_sales,cogs,net_sales-cogs gross_profit,case when net_sales=0 then 0 else (net_sales-cogs)/net_sales*100 end margin_percent
       from line_products order by net_sales desc limit 100) x),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(to_jsonb(x) order by x.net_sales desc,x.category_label) from
      (select category_id,category_label,quantity,gross_sales,discounts,net_sales,cogs,net_sales-cogs gross_profit
       from category_sales order by net_sales desc limit 100) x),'[]'::jsonb),
    'outlets',coalesce((select jsonb_agg(to_jsonb(x) order by x.net_sales desc,x.outlet_name) from
      (select os.*,os.net_sales-os.cogs gross_profit from outlet_sales os) x),'[]'::jsonb),
    'payment_methods',coalesce((select jsonb_agg(to_jsonb(payment_summary) order by received desc) from payment_summary),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(to_jsonb(expense_rows) order by incurred_on desc,id) from expense_rows),'[]'::jsonb),
    'cash_movements',coalesce((select jsonb_agg(jsonb_build_object('date',m.created_at,'outlet_id',m.outlet_id,
      'account_id',m.cash_account_id,'account',a.name,'reason',m.reason,'amount',m.amount,'reference_id',m.reference_id)
      order by m.created_at desc,m.id) from public.cash_movements m join public.cash_accounts a on a.id=m.cash_account_id
      where m.organization_id=p_organization_id and m.outlet_id=any(selected)
        and m.created_at>=p_from::timestamptz and m.created_at<p_until::timestamptz),'[]'::jsonb),
    'account_balances',coalesce((select jsonb_agg(to_jsonb(account_summary) order by name,outlet_id) from account_summary),'[]'::jsonb),
    'inventory',jsonb_build_object('quantity',it.quantity,'valuation',it.value,
      'items',coalesce((select jsonb_agg(to_jsonb(valuation) order by product,variant) from valuation),'[]'::jsonb)),
    'low_stock',coalesce((select jsonb_agg(to_jsonb(low_stock) order by quantity,product) from low_stock),'[]'::jsonb),
    'inventory_movements',coalesce((select jsonb_agg(to_jsonb(movements) order by created_at desc,id) from movements),'[]'::jsonb),
    'waste',coalesce((select jsonb_agg(to_jsonb(waste) order by created_at desc,id) from waste),'[]'::jsonb),
    'production',coalesce((select jsonb_agg(to_jsonb(production) order by produced_at desc,id) from production),'[]'::jsonb),
    'payment_reconciliation',coalesce((select jsonb_agg(to_jsonb(payment_reconciliation) order by method,status) from payment_reconciliation),'[]'::jsonb),
    'cashiers',coalesce((select jsonb_agg(to_jsonb(cashier_performance) order by total_sales desc) from cashier_performance),'[]'::jsonb),
    'recent_transactions',coalesce((select jsonb_agg(to_jsonb(recent) order by finalized_at desc) from recent),'[]'::jsonb)
  ) into result
  from sales_summary s cross join refund_summary r cross join expense_summary ex
    cross join other_income_summary oi cross join loan_expense_summary le cross join waste_summary ws
    cross join cash_shortage_summary css cross join inventory_totals it;
  return result;
end;
$$;

grant create on schema public to pos_writer;
alter function public.analytics_report(uuid,date,date,uuid[],uuid,uuid,text,text) owner to pos_writer;
revoke all on function public.analytics_report(uuid,date,date,uuid[],uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.analytics_report(uuid,date,date,uuid[],uuid,uuid,text,text) to authenticated;
revoke create on schema public from pos_writer;
do $$ begin execute format('revoke pos_identity,pos_writer,pos_auditor from %I',current_user); end; $$;
commit;
