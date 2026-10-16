-- New POS database only. No DROP, TRUNCATE, data replacement, or legacy import.
-- Fail on name collisions: never silently adopt an existing site's tables.
begin;

create schema private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
create function private.pos_tables() returns text[] language sql immutable set search_path = '' as $$
  select array['organizations','profiles','organization_members','outlets','categories','products','product_variants',
    'units','suppliers','inventory_balances','inventory_movements','purchase_orders','purchase_order_items',
    'goods_receipts','goods_receipt_items','recipes','recipe_items','production_batches','production_inputs','production_outputs',
    'waste_records','customers','promotions','orders','order_items','payments','refunds','cashier_shifts','cash_accounts',
    'cash_movements','expenses','expense_categories','financial_accounts','journal_entries','journal_lines','assets',
    'loans','loan_payments','audit_logs','application_settings']::text[];
$$;
create type public.app_role as enum
  ('owner', 'admin', 'manager', 'cashier', 'inventory_staff', 'finance_staff');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 160),
  avatar_url text check (length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null check (length(code) between 1 and 40),
  name text not null check (length(trim(name)) between 1 and 160),
  address text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id), unique (organization_id, code)
);
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  role public.app_role not null,
  -- NULL means all outlets; otherwise the membership is limited to this outlet.
  outlet_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, id), unique (organization_id, user_id),
  foreign key (organization_id, outlet_id) references public.outlets(organization_id, id),
  check (role not in ('owner', 'admin') or outlet_id is null)
);
create index organization_members_user_idx on public.organization_members(user_id, organization_id) where is_active;

create function private.touch_updated_at() returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'Immutable identity' using errcode = '23514';
  end if;
  if to_jsonb(new) ? 'organization_id' and
    (to_jsonb(new)->>'organization_id') is distinct from (to_jsonb(old)->>'organization_id') then
    raise exception 'Immutable organization' using errcode = '23514';
  end if;
  if to_jsonb(new) ? 'outlet_id' and tg_table_name <> 'organization_members' and
    (to_jsonb(new)->>'outlet_id') is distinct from (to_jsonb(old)->>'outlet_id') then
    raise exception 'Immutable outlet' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Metadata from signup is deliberately ignored: it cannot grant membership/role.
create function private.handle_new_user() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.profiles(id) values (new.id);
  return new;
end;
$$;
create trigger pos_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();
-- Existing Auth users receive empty profiles without overwriting any profile.
insert into public.profiles(id) select id from auth.users on conflict (id) do nothing;

-- Definer helpers read membership directly and never invoke its RLS recursively.
-- They bind auth.uid(), never JWT user_metadata, role claims or a supplied user id.
create function private.has_role(p_org uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org and m.user_id = (select auth.uid())
      and m.is_active and m.role = any(p_roles) and o.archived_at is null
  );
$$;
create function private.can_access(p_org uuid, p_outlet uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org and m.user_id = (select auth.uid())
      and m.is_active and m.role = any(p_roles) and o.archived_at is null
      and (m.outlet_id is null or m.outlet_id = p_outlet)
      and (p_outlet is null or exists (
        select 1 from public.outlets s where s.id = p_outlet and s.organization_id = p_org
      ))
  );
$$;
create function private.require_access(p_org uuid, p_outlet uuid, p_roles public.app_role[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_access(p_org, p_outlet, p_roles) or (p_outlet is not null and not exists (
    select 1 from public.outlets where id = p_outlet and organization_id = p_org and archived_at is null
  )) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
end;
$$;

-- Outlet SELECT/RETURNING must work while an outlet is being inserted or
-- archived; operational RPCs still require an existing active outlet above.
create function private.can_view_outlet(p_org uuid, p_outlet uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.is_active
      and o.archived_at is null and (m.outlet_id is null or m.outlet_id = p_outlet)
  );
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_role(uuid, public.app_role[]) to authenticated;
grant execute on function private.can_access(uuid, uuid, public.app_role[]) to authenticated;
grant execute on function private.can_view_outlet(uuid, uuid) to authenticated;
-- Fail closed at this migration boundary, even if a later migration fails.
-- Supabase may give API roles default table grants; remove them immediately.
do $$
declare t text;
begin
  foreach t in array array['organizations','profiles','outlets','organization_members'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$$;
commit;
