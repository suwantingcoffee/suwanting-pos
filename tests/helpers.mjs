import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';

export const root = new URL('../', import.meta.url);
export async function migratedDatabase({ restrictedMigrator = false, onMigration, database } = {}) {
  const db = database ?? new PGlite();
  // Only the harness emulates Supabase Auth. Production migrations never create
  // or replace auth.users/auth.uid or API roles supplied by Supabase.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
    $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create table public.unrelated_existing_data (id integer primary key, value text);
    insert into public.unrelated_existing_data values (1, 'preserve me');
    grant select on public.unrelated_existing_data to authenticated;
    -- Model Supabase's broad default grants, so migration boundaries must
    -- explicitly remove them before any policy migration has run.
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  if (restrictedMigrator) {
    await db.exec('create role pos_migrator nologin noinherit createrole nosuperuser nobypassrls');
    const { rows: [database] } = await db.query('select current_database() as name');
    // PGlite cannot GRANT on its template1 catalog (XX000). Model the
    // database-owning, non-superuser Supabase installer with ownership instead.
    await db.exec(`alter database "${database.name.replaceAll('"', '""')}" owner to pos_migrator`);
    await db.exec(`
      alter schema public owner to pos_migrator;
      grant usage on schema auth to pos_migrator with grant option;
      grant execute on function auth.uid() to pos_migrator with grant option;
      grant select, references, trigger on auth.users to pos_migrator;
      set role pos_migrator;
      alter default privileges in schema public grant all on tables to anon, authenticated;
    `);
  }
  const dir = new URL('supabase/migrations/', root);
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) {
    try { await db.exec(await readFile(new URL(file, dir), 'utf8')); }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`, { cause: error }); }
    if (onMigration) await onMigration(db, file);
  }
  if (restrictedMigrator) await db.exec('reset role');
  return db;
}

export async function asUser(db, user, sql, params = [], metadata = {}) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${user ? 'authenticated' : 'anon'}`);
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: user ?? '', role: user ? 'authenticated' : 'anon', user_metadata: metadata })]);
    const result = await db.query(sql, params);
    await db.exec('commit');
    return result.rows;
  } catch (error) { await db.exec('rollback'); throw error; }
}
