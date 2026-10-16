begin;
-- PostgreSQL numeric accepts NaN, including on constrained numeric(18,2).
-- Reject non-finite values at every storage boundary, not only in RPC input.
do $$
declare c record;
begin
  for c in select table_name, column_name from information_schema.columns
    where table_schema = 'public' and table_name = any(private.pos_tables()) and data_type = 'numeric' loop
    execute format('alter table public.%I add constraint %I check (%I::text not in (''NaN'',''Infinity'',''-Infinity''))',
      c.table_name, c.table_name || '_' || c.column_name || '_finite', c.column_name);
  end loop;
  for c in select table_name, column_name from information_schema.columns
    where table_schema = 'public' and table_name = any(private.pos_tables()) and column_name in ('name','code','sku') loop
    execute format('alter table public.%I add constraint %I check (length(trim(%I)) between 1 and 160)',
      c.table_name, c.table_name || '_' || c.column_name || '_nonempty', c.column_name);
  end loop;
end;
$$;
-- SELECT FOR UPDATE requires a column UPDATE privilege and an UPDATE policy.
-- The append-only trigger still forbids mutation; the privilege is for locking
-- the parent loan while summing principal repayments, preventing overpayment.
grant update (id) on public.loans to pos_writer;
create policy internal_lock on public.loans for update to pos_writer using (true) with check (true);
do $$ begin execute format('revoke pos_identity, pos_writer, pos_auditor from %I', current_user); end; $$;
commit;
