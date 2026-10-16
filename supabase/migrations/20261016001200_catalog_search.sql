begin;
create function public.search_product_ids(p_organization_id uuid,p_search text default '',p_category_id uuid default null,p_active text default '',
  p_page integer default 1,p_page_size integer default 20) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_page<1 or p_page_size not between 1 and 100 then raise exception 'Invalid pagination' using errcode='22023'; end if;
  with filtered as (
    select p.id,p.name from public.products p where p.organization_id=p_organization_id and p.archived_at is null
      and (p_category_id is null or p.category_id=p_category_id) and (p_active='' or p.is_active=(p_active='active'))
      and (p_search='' or strpos(lower(p.name),lower(p_search))>0 or exists(select 1 from public.product_variants v where v.product_id=p.id and v.archived_at is null
        and strpos(lower(v.sku||' '||coalesce(v.barcode,'')||' '||v.name),lower(p_search))>0))
  ), page as(select * from filtered order by name,id limit p_page_size offset (p_page-1)*p_page_size)
  select jsonb_build_object('count',(select count(*) from filtered),'ids',coalesce(jsonb_agg(id order by name,id),'[]'::jsonb)) into result from page;
  return result;
end; $$;
revoke all on function public.search_product_ids(uuid,text,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.search_product_ids(uuid,text,uuid,text,integer,integer) to authenticated;
commit;
