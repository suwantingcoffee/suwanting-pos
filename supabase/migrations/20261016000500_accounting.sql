begin;
-- Row-lock privileges are column-limited; these tables are never updated by RPC.
grant update (id) on public.products, public.product_variants, public.recipes, public.recipe_items to pos_writer;
create policy internal_lock on public.products for update to pos_writer using (true) with check (true);
create policy internal_lock on public.product_variants for update to pos_writer using (true) with check (true);
create policy internal_lock on public.recipes for update to pos_writer using (true) with check (true);
create policy internal_lock on public.recipe_items for update to pos_writer using (true) with check (true);

create function private.initialize_chart() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.financial_accounts(organization_id, code, name, kind) values
    (new.id, '1000', 'Kas dan bank', 'asset'),
    (new.id, '2000', 'Utang pinjaman', 'liability'),
    (new.id, '4000', 'Pendapatan penjualan', 'revenue'),
    (new.id, '5000', 'Beban operasional', 'expense'),
    (new.id, '6000', 'Beban bunga', 'expense');
  return new;
end;
$$;
create trigger initialize_chart after insert on public.organizations for each row execute function private.initialize_chart();
create function private.protect_system_account() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.code in ('1000','2000','4000','5000','6000') and
    (new.code <> old.code or new.kind <> old.kind or new.archived_at is distinct from old.archived_at) then
    raise exception 'System account code, kind and active status are fixed' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger protect_system_account before update on public.financial_accounts for each row execute function private.protect_system_account();

-- Every money movement posts its balanced journal in the same transaction.
-- The GL uses one control cash account; cash_accounts/ledger provide subaccounts.
create function private.post_cash_journal() returns trigger language plpgsql security definer set search_path = '' as $$
declare entry uuid; cash uuid; counter uuid; principal numeric; interest numeric;
begin
  select id into cash from public.financial_accounts where organization_id = new.organization_id and code = '1000';
  if new.reason in ('sale','refund') then
    select id into counter from public.financial_accounts where organization_id = new.organization_id and code = '4000';
  elsif new.reason = 'expense' then
    select id into counter from public.financial_accounts where organization_id = new.organization_id and code = '5000';
  elsif new.reason in ('loan','loan_payment') then
    select id into counter from public.financial_accounts where organization_id = new.organization_id and code = '2000';
  else
    raise exception 'No automatic journal mapping for cash movement' using errcode = '23514';
  end if;
  insert into public.journal_entries(organization_id, outlet_id, description, idempotency_key, posted_by)
    values (new.organization_id, new.outlet_id, new.reason, new.id, auth.uid()) returning id into entry;
  insert into public.journal_lines(organization_id, journal_entry_id, financial_account_id, debit, credit)
    values (new.organization_id, entry, cash, greatest(new.amount,0), greatest(-new.amount,0));
  if new.reason = 'loan_payment' then
    select principal_amount, interest_amount into principal, interest from public.loan_payments where id = new.reference_id;
    if principal > 0 then
      insert into public.journal_lines(organization_id, journal_entry_id, financial_account_id, debit, credit)
        values (new.organization_id, entry, counter, principal, 0);
    end if;
    if interest > 0 then
      insert into public.journal_lines(organization_id, journal_entry_id, financial_account_id, debit, credit)
        select new.organization_id, entry, id, interest, 0 from public.financial_accounts where organization_id = new.organization_id and code = '6000';
    end if;
  else
    insert into public.journal_lines(organization_id, journal_entry_id, financial_account_id, debit, credit)
      values (new.organization_id, entry, counter, greatest(-new.amount,0), greatest(new.amount,0));
  end if;
  return new;
end;
$$;
create trigger post_cash_journal after insert on public.cash_movements for each row execute function private.post_cash_journal();
grant create on schema private to pos_writer;
alter function private.initialize_chart() owner to pos_writer;
alter function private.post_cash_journal() owner to pos_writer;
revoke create on schema private from pos_writer;
revoke all on function private.initialize_chart(), private.protect_system_account(), private.post_cash_journal() from public, anon, authenticated;
commit;
