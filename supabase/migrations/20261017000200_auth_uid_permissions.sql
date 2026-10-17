-- Forward repair for installations missing the privileges required by
-- SECURITY DEFINER helpers, writers and the audit trigger. Safe to reapply:
-- no data writes, RLS changes, Auth table access or role memberships.
begin;

grant usage on schema auth to pos_identity, pos_writer, pos_auditor;
grant execute on function auth.uid() to pos_identity, pos_writer, pos_auditor;

-- A hosted project's postgres role may have USAGE without GRANT OPTION on
-- schema auth. The grants above can then be no-ops with a warning. Migration
-- 003 removes this dependency; do not abort the pending repair chain here.

commit;
