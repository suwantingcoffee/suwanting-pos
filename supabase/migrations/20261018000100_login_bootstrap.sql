begin;

-- The hosted installer can be a non-superuser CREATEROLE role. Temporarily
-- grant it SET ROLE for the ownership change, then remove that capability.
do $$ begin execute format('grant pos_writer to %I with inherit true', current_user); end; $$;
grant create on schema public to pos_writer;

-- First authenticated login on a new POS database gets a usable workspace.
-- Existing organizations are never exposed or auto-assigned to a random user.
create function public.bootstrap_workspace(
  p_organization_name text default 'Suwanting Coffee',
  p_outlet_name text default 'Outlet Utama'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.request_user_id();
  existing_org uuid;
  organization uuid;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_organization_name is null or length(trim(p_organization_name)) not between 1 and 160 then
    raise exception 'Organization name is required' using errcode = '22023';
  end if;
  if p_outlet_name is null or length(trim(p_outlet_name)) not between 1 and 160 then
    raise exception 'Outlet name is required' using errcode = '22023';
  end if;

  -- Serialize first-login requests. This makes retries and two browser tabs safe.
  perform pg_advisory_xact_lock(hashtextextended('suwanting-pos-first-workspace', 0));

  select m.organization_id into existing_org
  from public.organization_members m
  where m.user_id = actor and m.is_active
  order by m.created_at
  limit 1;
  if existing_org is not null then
    return existing_org;
  end if;

  -- A user without membership must be invited by an existing owner once any
  -- organization exists. Never silently attach that user to another tenant.
  if exists (select 1 from public.organizations where archived_at is null) then
    raise exception 'Workspace already exists; an owner must add this account'
      using errcode = '42501';
  end if;

  insert into public.organizations(name) values (trim(p_organization_name)) returning id into organization;
  insert into public.organization_members(organization_id, user_id, role)
    values (organization, actor, 'owner');
  insert into public.outlets(organization_id, code, name)
    values (organization, 'MAIN', trim(p_outlet_name));
  return organization;
end;
$$;

alter function public.bootstrap_workspace(text, text) owner to pos_writer;
revoke all on function public.bootstrap_workspace(text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_workspace(text, text) to authenticated;

revoke create on schema public from pos_writer;
do $$ begin execute format('revoke pos_writer from %I', current_user); end; $$;

commit;
