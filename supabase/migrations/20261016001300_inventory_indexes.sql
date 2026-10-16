begin;
-- Add only missing FK access paths introduced by the inventory migrations.
-- Checking index prefixes avoids duplicate indexes already supplied by UNIQUE.
do $$ declare r record; begin
  for r in
    select c.conrelid::regclass as tbl,c.conname,c.conkey,
      string_agg(quote_ident(a.attname),', ' order by k.ordinality) as cols
    from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(attnum,ordinality)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
    join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and n.nspname='public' and t.relname=any(private.pos_tables())
    group by c.conrelid,c.conname,c.conkey
  loop
    if not exists(select 1 from pg_index i where i.indrelid=r.tbl and i.indisvalid and i.indpred is null
      and array(select x from unnest(i.indkey::smallint[]) with ordinality u(x,n) where n<=cardinality(r.conkey) order by n)=r.conkey) then
      execute format('create index %I on %s (%s)',left(r.conname,50)||'_fk_idx',r.tbl,r.cols);
    end if;
  end loop;
end; $$;
commit;
