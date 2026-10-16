begin;
-- Separate NOLOGIN function owners. No BYPASSRLS and no schema creation rights
-- remain after installation. Never grant these roles to API users.
create role pos_identity nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role pos_writer nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role pos_auditor nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
-- Supabase's postgres migration role has CREATEROLE, not unrestricted superuser.
-- Temporary membership permits ALTER OWNER, then is revoked by migration 006.
do $$ begin execute format('grant pos_identity, pos_writer, pos_auditor to %I with inherit true', current_user); end; $$;
grant usage on schema public, private, auth to pos_identity, pos_writer, pos_auditor;
grant execute on function auth.uid() to pos_identity, pos_writer, pos_auditor;
grant select on public.organizations, public.organization_members, public.outlets to pos_identity;
grant insert on public.profiles to pos_identity;
grant insert on public.audit_logs to pos_auditor;
grant insert on public.organizations, public.outlets, public.organization_members, public.financial_accounts,
  public.inventory_balances, public.inventory_movements, public.purchase_orders, public.purchase_order_items,
  public.goods_receipts, public.goods_receipt_items, public.production_batches, public.production_inputs,
  public.production_outputs, public.waste_records, public.orders, public.order_items, public.payments,
  public.refunds, public.cashier_shifts, public.cash_movements, public.expenses, public.journal_entries,
  public.journal_lines, public.loans, public.loan_payments to pos_writer;
grant update on public.organizations, public.organization_members, public.inventory_balances,
  public.purchase_orders, public.orders, public.cashier_shifts to pos_writer;
grant execute on function private.has_role(uuid, public.app_role[]),
  private.can_access(uuid, uuid, public.app_role[]), private.require_access(uuid, uuid, public.app_role[]) to pos_writer;
grant create on schema private to pos_identity;
alter function private.handle_new_user() owner to pos_identity;
alter function private.has_role(uuid, public.app_role[]) owner to pos_identity;
alter function private.can_access(uuid, uuid, public.app_role[]) owner to pos_identity;
alter function private.can_view_outlet(uuid, uuid) owner to pos_identity;
alter function private.require_access(uuid, uuid, public.app_role[]) owner to pos_identity;
grant execute on function private.can_access(uuid, uuid, public.app_role[]) to pos_identity;
revoke create on schema private from pos_identity;

-- Deny API access first, then grant only the operations supported by policies.
revoke create on schema public from public, anon, authenticated;
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename = any(private.pos_tables()) loop
    execute format('revoke all on public.%I from public, anon, authenticated', t.tablename);
    execute format('grant select on public.%I to pos_writer', t.tablename);
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
    execute format('grant select on public.%I to authenticated', t.tablename);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()', t.tablename);
    execute format('create policy internal_read on public.%I for select to pos_writer using (true)', t.tablename);
  end loop;
end;
$$;
create policy identity_org_read on public.organizations for select to pos_identity using (true);
create policy identity_member_read on public.organization_members for select to pos_identity using (true);
create policy identity_outlet_read on public.outlets for select to pos_identity using (true);
create policy identity_profile_insert on public.profiles for insert to pos_identity with check (true);
create policy audit_insert on public.audit_logs for insert to pos_auditor with check (true);
do $$
declare r record;
begin
  -- Only tables for which the dedicated writer received INSERT/UPDATE grants.
  for r in select table_name, privilege_type from information_schema.role_table_grants
    where grantee = 'pos_writer' and table_schema = 'public' and privilege_type in ('INSERT','UPDATE') loop
    if r.privilege_type = 'INSERT' then
      execute format('create policy internal_insert on public.%I for insert to pos_writer with check (true)', r.table_name);
    else
      execute format('create policy internal_update on public.%I for update to pos_writer using (true) with check (true)', r.table_name);
    end if;
  end loop;
end;
$$;

create policy profile_self_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profile_self_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant update (full_name, avatar_url) on public.profiles to authenticated;
create policy organization_read on public.organizations for select to authenticated
  using (private.has_role(id, array['owner','admin','manager','cashier','inventory_staff','finance_staff']::public.app_role[]));
create policy organization_update on public.organizations for update to authenticated
  using (private.has_role(id, array['owner','admin']::public.app_role[]))
  with check (private.has_role(id, array['owner','admin']::public.app_role[]));
grant update (name) on public.organizations to authenticated;
create policy member_read on public.organization_members for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(organization_id, array['owner','admin']::public.app_role[]));

-- Read matrices. NULL outlet on shared master data permits every active member.
do $$
declare t text; roles text;
begin
  foreach t in array array['outlets','units','categories','products','product_variants','suppliers','inventory_balances',
    'inventory_movements','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items',
    'recipes','recipe_items','production_batches','production_inputs','production_outputs','waste_records',
    'customers','promotions','orders','order_items','payments','refunds','cashier_shifts','cash_accounts','cash_movements',
    'expenses','expense_categories','financial_accounts','journal_entries','assets','loans','loan_payments','audit_logs','application_settings'] loop
    roles := case
      when t in ('audit_logs','application_settings') then '''owner'',''admin'''
      when t in ('expenses','expense_categories','financial_accounts','journal_entries','assets','loans','loan_payments','cash_movements') then '''owner'',''admin'',''manager'',''finance_staff'''
      when t in ('customers','orders','order_items','payments','refunds','cashier_shifts','cash_accounts','promotions') then '''owner'',''admin'',''manager'',''cashier'',''finance_staff'''
      when t in ('suppliers','inventory_balances','inventory_movements','purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items','recipes','recipe_items','production_batches','production_inputs','production_outputs','waste_records') then '''owner'',''admin'',''manager'',''inventory_staff'',''finance_staff'''
      else '''owner'',''admin'',''manager'',''cashier'',''inventory_staff'',''finance_staff''' end;
    if t = 'outlets' then
      execute format('create policy tenant_read on public.%I for select to authenticated using (private.can_view_outlet(organization_id, id))', t);
    elsif exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'outlet_id') then
      execute format('create policy tenant_read on public.%I for select to authenticated using (private.can_access(organization_id, outlet_id, array[%s]::public.app_role[]))', t, roles);
    else
      execute format('create policy tenant_read on public.%I for select to authenticated using (private.has_role(organization_id, array[%s]::public.app_role[]))', t, roles);
    end if;
  end loop;
end;
$$;
-- Outlet visibility for journal lines comes from their entry, never a supplied scope.
create policy journal_line_read on public.journal_lines for select to authenticated using (
  exists (select 1 from public.journal_entries e where e.id = journal_entry_id and e.organization_id = journal_lines.organization_id)
);

-- Direct writes are limited to editable master data. No authenticated DELETE.
do $$
declare t text; roles text; scope text; permission text;
begin
  foreach t in array array['outlets','units','categories','products','product_variants','suppliers','recipes','recipe_items',
    'customers','promotions','cash_accounts','expense_categories','financial_accounts','assets','application_settings'] loop
    roles := case
      when t in ('outlets','application_settings') then '''owner'',''admin'''
      when t in ('cash_accounts','expense_categories','financial_accounts','assets') then '''owner'',''admin'',''finance_staff'''
      when t = 'customers' then '''owner'',''admin'',''manager'',''cashier'''
      when t = 'promotions' then '''owner'',''admin'',''manager'''
      else '''owner'',''admin'',''manager'',''inventory_staff''' end;
    scope := case when t in ('promotions','cash_accounts','assets') then 'outlet_id' else 'null' end;
    permission := case when scope = 'null' then format('private.has_role(organization_id, array[%s]::public.app_role[])', roles)
      else format('private.can_access(organization_id, %s, array[%s]::public.app_role[])', scope, roles) end;
    execute format('grant insert, update on public.%I to authenticated', t);
    execute format('create policy tenant_insert on public.%I for insert to authenticated with check (%s)', t, permission);
    execute format('create policy tenant_update on public.%I for update to authenticated using (%s) with check (%s)', t, permission, permission);
  end loop;
end;
$$;

create function private.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_logs(organization_id, outlet_id, actor_id, table_name, record_id, action)
    values (case when tg_table_name = 'organizations' then (row_data->>'id')::uuid else (row_data->>'organization_id')::uuid end,
      (row_data->>'outlet_id')::uuid, auth.uid(), tg_table_name, (row_data->>'id')::uuid, tg_op);
  return null;
end;
$$;
grant create on schema private to pos_auditor;
alter function private.audit_change() owner to pos_auditor;
revoke create on schema private from pos_auditor;
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename = any(private.pos_tables()) and tablename not in ('profiles','audit_logs') loop
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()', t.tablename);
  end loop;
end;
$$;
create function private.reject_mutation() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Append-only record; use a compensating transaction' using errcode = '42501'; end;
$$;
do $$
declare t text;
begin
  foreach t in array array['audit_logs','journal_entries','journal_lines','inventory_movements','cash_movements',
    'order_items','payments','refunds','goods_receipts','goods_receipt_items','production_batches',
    'production_inputs','production_outputs','waste_records','expenses','loans','loan_payments','purchase_order_items'] loop
    execute format('create trigger append_only before update or delete on public.%I for each row execute function private.reject_mutation()', t);
  end loop;
end;
$$;

-- A posted entry must be balanced and contain at least two lines, even if a
-- future function accidentally omits validation. Checked at transaction commit.
create function private.check_journal_balance() returns trigger language plpgsql security definer set search_path = '' as $$
declare entry_id uuid; line_count bigint; net numeric;
begin
  if tg_table_name = 'journal_entries' then
    entry_id := new.id;
  else
    entry_id := new.journal_entry_id;
  end if;
  select count(*), coalesce(sum(debit-credit), 0) into line_count, net from public.journal_lines where journal_entry_id = entry_id;
  if line_count < 2 or net <> 0 then raise exception 'Journal must balance with at least two lines' using errcode = '23514'; end if;
  return null;
end;
$$;
grant create on schema private to pos_writer;
alter function private.check_journal_balance() owner to pos_writer;
revoke create on schema private from pos_writer;
create constraint trigger journal_balanced_entry after insert on public.journal_entries deferrable initially deferred for each row execute function private.check_journal_balance();
create constraint trigger journal_balanced_lines after insert on public.journal_lines deferrable initially deferred for each row execute function private.check_journal_balance();
revoke all on function private.audit_change(), private.reject_mutation(), private.check_journal_balance(), private.touch_updated_at() from public, anon, authenticated;
commit;
