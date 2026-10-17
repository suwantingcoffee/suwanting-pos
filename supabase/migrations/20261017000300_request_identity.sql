-- Forward repair for hosted Supabase: postgres is not a superuser and may not
-- grant USAGE on schema auth to custom function owners. Read the subject set by
-- the JWT-verifying gateway instead. Membership/roles still come from tables.
-- No data changes, policy changes, Auth grants or elevated function owners.
begin;

do $$ begin execute format('grant pos_identity, pos_writer, pos_auditor to %I with inherit true', current_user); end; $$;

create or replace function private.request_user_id() returns uuid
language sql stable security invoker set search_path = '' as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is not null then
      nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
    else nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  end;
$$;
revoke all on function private.request_user_id() from public, anon, authenticated;
grant execute on function private.request_user_id() to pos_identity, pos_writer, pos_auditor;
grant create on schema private to pos_identity;
alter function private.request_user_id() owner to pos_identity;
revoke create on schema private from pos_identity;

-- Recompile only POS-owned functions. CREATE OR REPLACE keeps OIDs, owners,
-- callers' grants, argument defaults, SECURITY DEFINER and search_path intact.
-- Browser RLS expressions may keep auth.uid(): authenticated already has USAGE.
do $$
declare f record;
begin
  for f in
    select pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and r.rolname in ('pos_identity', 'pos_writer', 'pos_auditor')
      and strpos(p.prosrc, 'auth.uid()') > 0
    order by p.oid
  loop
    execute replace(f.definition, 'auth.uid()', 'private.request_user_id()');
  end loop;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and r.rolname in ('pos_identity', 'pos_writer', 'pos_auditor')
      and strpos(p.prosrc, 'auth.uid()') > 0
  ) then
    raise exception 'POS function still depends on auth.uid(); review migration' using errcode = '23514';
  end if;
end;
$$;

do $$ begin execute format('revoke pos_identity, pos_writer, pos_auditor from %I', current_user); end; $$;
commit;
