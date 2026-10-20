import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, unlink, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import pg from 'pg';

export const owner = '10000000-0000-4000-8000-000000000001';
export const cashier = '10000000-0000-4000-8000-000000000002';
export const secondCashier = '10000000-0000-4000-8000-000000000003';
export const inactive = '10000000-0000-4000-8000-000000000004';
export const admin = '10000000-0000-4000-8000-000000000005';

export async function startDatabase() {
    let pool, shutdown;
    if (process.env.TEST_DATABASE_URL) {
        const connection = new URL(process.env.TEST_DATABASE_URL);
        if (!connection.pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must target a dedicated database ending in _test');
        const control = new pg.Pool({ connectionString: connection.href });
        const name = 'scpos_' + randomUUID().replaceAll('-', '') + '_test';
        await control.query('create database "' + name + '"');
        connection.pathname = '/' + name;
        pool = new pg.Pool({ connectionString: connection.href, max: 8 });
        shutdown = async () => { await pool.end(); await control.query('drop database "' + name + '"'); await control.end(); };
    } else {
        const runtime = process.env.PAGES_TEST_RUNTIME || 'D:/Website/.tools/pos-pages-runtime';
        const bin = join(runtime, 'node_modules/@embedded-postgres/windows-x64/native/bin');
        const root = resolve('.test-artifacts/postgres');
        await mkdir(root, { recursive: true });
        const directory = await mkdtemp(join(root, 'run-'));
        const data = join(directory, 'data');
        const password = randomUUID();
        const pwfile = join(directory, 'password.txt');
        await writeFile(pwfile, password, { mode: 0o600 });
        const exec = promisify(execFile);
        const control = args => new Promise((done, fail) => {
            const child = spawn(join(bin, 'pg_ctl.exe'), args, { windowsHide: true, stdio: 'ignore' });
            child.once('error', fail);
            child.once('exit', code => code === 0 ? done() : fail(new Error('pg_ctl failed: ' + code)));
        });
        await exec(join(bin, 'initdb.exe'), ['-D', data, '-U', 'postgres', '--pwfile=' + pwfile, '--auth-host=scram-sha-256', '--auth-local=trust', '--encoding=UTF8', '--locale=C'], { windowsHide: true });
        await unlink(pwfile);
        const reservation = createServer();
        await new Promise((done, fail) => reservation.listen(0, '127.0.0.1', done).once('error', fail));
        const port = reservation.address().port;
        await new Promise(done => reservation.close(done));
        await control(['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
        pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', max: 8 });
        shutdown = async () => { await pool.end(); await control(['-D', data, '-m', 'fast', '-w', 'stop']); };
    }
    try {
        await pool.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
            if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
            create schema auth;
            create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
            create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
            grant usage on schema public,auth to anon,authenticated;
            grant execute on function auth.uid() to authenticated;`);
        const migrations = new URL('../../supabase/migrations/', import.meta.url);
        for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(name, migrations), 'utf8'));
    } catch (error) { await shutdown(); throw error; }
    const initialSettings = (await pool.query('select data from suwanting_pos.settings where id=1')).rows[0].data;
    const db = {
        pool,
        stop: shutdown,
        async asUser(user, sql, params = [], claims = {}) {
            const connection = await pool.connect();
            try {
                await connection.query('begin');
                await connection.query(user ? 'set local role authenticated' : 'set local role anon');
                await connection.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ ...claims, sub: user })]);
                const result = await connection.query(sql, params);
                await connection.query('commit');
                return result.rows;
            } catch (error) { await connection.query('rollback'); throw error; }
            finally { connection.release(); }
        },
        async rpc(user, name, args = {}) {
            if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid test function');
            const keys = Object.keys(args);
            if (keys.some(key => !/^p_[a-z_]+$/.test(key))) throw new Error('Invalid argument name');
            const sql = 'select public.scpos_' + name + '(' + keys.map((key, index) => `${key} => $${index + 1}`).join(',') + ') result';
            const values = keys.map(key => typeof args[key] === 'object' && args[key] !== null ? JSON.stringify(args[key]) : args[key]);
            return (await this.asUser(user, sql, values))[0].result;
        },
        async reset() {
            await pool.query('update suwanting_pos.settings set data=$1::jsonb where id=1', [JSON.stringify(initialSettings)]);
            await pool.query(`truncate suwanting_pos.audit_logs,suwanting_pos.stock_movements,suwanting_pos.sale_item_ingredients,suwanting_pos.sale_items,suwanting_pos.sales,suwanting_pos.recipe_items,suwanting_pos.recipes,suwanting_pos.product_variants,suwanting_pos.products,suwanting_pos.customers,suwanting_pos.ingredients,suwanting_pos.inventory_units,suwanting_pos.categories,suwanting_pos.profiles,auth.users restart identity;
                insert into auth.users(id,email) values('${owner}','owner@example.test'),('${cashier}','cashier@example.test'),('${secondCashier}','cashier2@example.test'),('${inactive}','inactive@example.test'),('${admin}','admin@example.test');
                update suwanting_pos.profiles set name='Owner Pengujian',role='owner',is_active=true where id='${owner}';
                update suwanting_pos.profiles set is_active=true where id in ('${cashier}','${secondCashier}');
                update suwanting_pos.profiles set role='admin',is_active=true,can_manage_catalog=true,can_discount=true where id='${admin}';
                update suwanting_pos.settings set data=data||'{"tax_enabled":true,"tax_rate":"11.00","simulate_payments":true}'::jsonb;
                insert into suwanting_pos.categories(name) values('Coffee');
                insert into suwanting_pos.inventory_units(name,symbol) values('Gram','g');
                insert into suwanting_pos.ingredients(name,sku,inventory_unit_id,stock_quantity,minimum_stock) values('Biji Kopi Uji','TEST-BIJI',1,100,10);
                insert into suwanting_pos.products(category_id,name,sku,product_type,selling_price) values(1,'Kopi Susu Suwanting','TEST-KSS','drink',24000);
                insert into suwanting_pos.product_variants(product_id,name,sku,price_adjustment) values(1,'Iced','TEST-ICED',2000);
                insert into suwanting_pos.recipes(product_id,product_variant_id) values(1,null),(1,1);
                insert into suwanting_pos.recipe_items values(1,1,18.125),(2,1,20.125);
                insert into suwanting_pos.customers(name,phone,email) values('Pelanggan Uji','081200000000','customer@example.test');`);
        },
    };
    return db;
}

export const payload = (changes = {}) => ({ idempotency_key: randomUUID(), items: [{ product_id: 1, quantity: 1, variant_id: null, notes: '' }], customer_id: null, customer_name: '', discount: '0', payment_method: 'cash', amount_received: '100000', payment_confirmed: false, ...changes });
export const pay = (db, user, data = payload()) => db.rpc(user, 'checkout', { p_data: data });
