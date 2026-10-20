-- Upgrade existing static POS installations; preserves catalog and stock data.
begin;
alter table suwanting_pos.products add column cost_price numeric(12,2) not null default 0 check(cost_price between 0 and 999999999.99);
alter table suwanting_pos.products add column description varchar(1000);

-- Keep original validated CRUD implementation private and extend product details atomically.
alter function public.scpos_save(text,jsonb) set schema suwanting_pos;
revoke all on function suwanting_pos.scpos_save(text,jsonb) from public,anon,authenticated;
create function public.scpos_save(p_entity text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles; result jsonb; updated jsonb; cost numeric; product_description text;
begin
    if p_entity<>'products' then return suwanting_pos.scpos_save(p_entity,p_data); end if;
    perform pg_advisory_xact_lock(741928351);
    actor:=suwanting_pos.actor('catalog',true);
    if p_data?'cost_price' then cost:=suwanting_pos.number_value(p_data,'cost_price',2,999999999.99); end if;
    if p_data?'description' then product_description:=suwanting_pos.text_value(p_data,'description',1000,false); end if;
    result:=suwanting_pos.scpos_save(p_entity,p_data-'cost_price'-'description');
    update suwanting_pos.products set cost_price=case when p_data?'cost_price' then cost else cost_price end,
        description=case when p_data?'description' then nullif(product_description,'') else products.description end
        where id=(result->>'id')::bigint returning to_jsonb(products) into updated;
    if result<>updated then perform suwanting_pos.audit(actor.id,'products.details_saved','products',updated->>'id',result,updated); end if;
    return updated;
end $$;
revoke all on function public.scpos_save(text,jsonb) from public,anon,authenticated;
grant execute on function public.scpos_save(text,jsonb) to authenticated;

create or replace function public.scpos_bootstrap() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles;
begin
    actor:=suwanting_pos.actor();
    return jsonb_build_object('profile',to_jsonb(actor),'settings',(select data from suwanting_pos.settings where id=1),
        'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]') from suwanting_pos.categories c where is_active and deleted_at is null),
        'products',(select coalesce(jsonb_agg(to_jsonb(p)-'cost_price' order by p.name),'[]') from(
            select p.*,c.name category_name,(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from suwanting_pos.product_variants v where product_id=p.id and is_active) variants
            from suwanting_pos.products p join suwanting_pos.categories c on c.id=p.category_id where p.is_active and c.is_active and p.deleted_at is null and c.deleted_at is null
        )p)
    );
end $$;
create or replace function public.scpos_status() returns jsonb language sql security definer set search_path='' as $$
    select jsonb_build_object('version',2,'server_time',now(),'has_owner',exists(select 1 from suwanting_pos.profiles where role='owner' and is_active))
$$;
notify pgrst,'reload schema';
commit;
