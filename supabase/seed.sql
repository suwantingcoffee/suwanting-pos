-- DEVELOPMENT ONLY. Disabled in config.toml. This file creates no Auth users,
-- passwords or memberships; sign up normally and call create_organization first.
-- Execute on your local disposable database in one session after replacing IDs:
-- BEGIN;
-- SET LOCAL app.environment = 'development';
-- SELECT set_config('app.seed_organization_id', '<your development org UUID>', true);
-- \i supabase/seed.sql
-- COMMIT;
do $$
declare org uuid;
begin
  if current_setting('app.environment', true) is distinct from 'development' then
    raise exception 'Seed refused: development opt-in is required';
  end if;
  org := nullif(current_setting('app.seed_organization_id', true), '')::uuid;
  if org is null or not exists (select 1 from public.organizations where id = org and archived_at is null) then
    raise exception 'An existing development organization is required';
  end if;
  insert into public.units(organization_id, code, name) values
    (org,'g','Gram'),(org,'kg','Kilogram'),(org,'ml','Mililiter'),(org,'l','Liter'),(org,'pc','Piece'),(org,'pcs','Pcs')
    on conflict (organization_id, code) do nothing;
  insert into public.categories(organization_id, name) values (org,'Kopi'),(org,'Non-kopi')
    on conflict (organization_id, name) do nothing;
  insert into public.outlets(organization_id, code, name) values (org,'DEV','Suwanting Development')
    on conflict (organization_id, code) do nothing;
  insert into public.application_settings(organization_id, key, value) values
    (org,'business_timezone','Asia/Jakarta'),(org,'receipt_footer','Terima kasih - DEVELOPMENT')
    on conflict (organization_id, key) do nothing;
end;
$$;
