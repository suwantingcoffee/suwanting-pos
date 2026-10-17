-- Read-only inspection before applying to a NEW Supabase project.
-- Any collision means stop: inspect and design a separate forward migration.
begin read only;
select current_user, current_database(), version();
select rolcreaterole, rolsuper, rolbypassrls from pg_roles where rolname = current_user;
-- Hosted postgres may report false for Auth grant options: Auth is managed by
-- Supabase. This is not a blocker once 20261017000300_request_identity.sql is
-- applied. SELECT/REFERENCES/TRIGGER remain required for profile setup only.
select has_schema_privilege(current_user, 'auth', 'USAGE WITH GRANT OPTION') as can_grant_auth_usage,
  has_function_privilege(current_user, 'auth.uid()', 'EXECUTE WITH GRANT OPTION') as can_grant_auth_uid,
  has_table_privilege(current_user, 'auth.users', 'SELECT') as can_backfill_profiles,
  has_table_privilege(current_user, 'auth.users', 'REFERENCES') as can_reference_users,
  has_table_privilege(current_user, 'auth.users', 'TRIGGER') as can_install_auth_trigger;
select schemaname, tablename from pg_tables
where schemaname = 'public' order by tablename;
select nspname from pg_namespace where nspname = 'private';
select rolname from pg_roles where rolname in ('pos_identity','pos_writer','pos_auditor');
select table_schema, table_name from information_schema.tables
where table_schema = 'supabase_migrations' order by table_name;
rollback;
