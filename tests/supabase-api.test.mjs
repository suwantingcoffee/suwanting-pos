import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';

// Opt-in integration test: actual GoTrue JWT + PostgREST, using only a PUBLIC
// API key. This script has no path to a hosted/production database.
const url = new URL(process.env.SUPABASE_TEST_URL || 'http://127.0.0.1:54321');
const key = process.env.SUPABASE_TEST_PUBLISHABLE_KEY;
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('HTTP tests are restricted to local Supabase. Hosted targets are refused.');
}
if (key?.startsWith('sb_secret_')) throw new Error('Tests require a public key.');
if (key?.startsWith('eyJ')) {
  const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (claims.role !== 'anon') throw new Error('Tests require a public anon/publishable key.');
}

async function request(path, { token, method = 'GET', body, allowError = false } = {}) {
  const response = await fetch(new URL(path, url), {
    method, headers: { apikey: key, ...(token && { Authorization: `Bearer ${token}` }),
      'Content-Type': 'application/json', Prefer: 'return=representation' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok && !allowError) throw new Error(`HTTP ${response.status}: ${data?.code || data?.error_code || 'request failed'}`);
  return { response, data };
}

test('local Supabase Auth + PostgREST: multiple roles, organizations and concurrent transactions',
  { skip: !key && 'SUPABASE_TEST_PUBLISHABLE_KEY not set; requires local Supabase/Docker' }, async t => {
    const actors = {};
    const suffix = randomUUID();
    for (const role of ['owner','admin','manager','cashier','inventory_staff','finance_staff','ownerB','outsider']) {
      const { data } = await request('/auth/v1/signup', { method: 'POST', body: {
        email: `${role}-${suffix}@example.test`, password: randomBytes(24).toString('base64url'),
        data: { role: 'owner', organization_id: randomUUID() },
      } });
      assert.ok(data.access_token, 'Local Auth must have email confirmation disabled');
      actors[role] = { id: data.user.id, token: data.access_token };
    }
    const api = (actor, path, options = {}) => request(`/rest/v1/${path}`, { token: actors[actor].token, ...options });
    const rpc = async (actor, fn, body) => (await api(actor, `rpc/${fn}`, { method: 'POST', body })).data;
    const insert = async (actor, table, body) => (await api(actor, table, { method: 'POST', body })).data[0].id;
    const org = await rpc('owner', 'create_organization', { p_name: `API A ${suffix}` });
    const orgB = await rpc('ownerB', 'create_organization', { p_name: `API B ${suffix}` });
    const outlet = await insert('owner', 'outlets', { organization_id: org, code: 'A', name: 'A' });
    const outlet2 = await insert('owner', 'outlets', { organization_id: org, code: 'A2', name: 'A2' });
    for (const role of ['admin','manager','cashier','inventory_staff','finance_staff']) {
      await rpc('owner', 'set_member', { p_organization_id: org, p_user_id: actors[role].id, p_role: role,
        p_outlet_id: ['manager','cashier','inventory_staff'].includes(role) ? outlet : null });
    }
    const unit = await insert('owner', 'units', { organization_id: org, code: 'pc', name: 'Piece' });
    const product = await insert('owner', 'products', { organization_id: org, name: 'API coffee' });
    const variant = await insert('owner', 'product_variants', { organization_id: org, product_id: product,
      unit_id: unit, sku: 'API', name: 'API variant', price: 25000 });
    const account = await insert('owner', 'cash_accounts', { organization_id: org, outlet_id: outlet, name: 'Cash', kind: 'cash' });
    await rpc('inventory_staff', 'adjust_inventory', { p_organization_id: org, p_outlet_id: outlet,
      p_variant_id: variant, p_quantity: 1, p_reason: 'Concurrency fixture' });
    const shift = await rpc('cashier', 'open_shift', { p_organization_id: org, p_outlet_id: outlet, p_cash_account_id: account, p_opening_cash: 0 });
    const sale = { p_organization_id: org, p_outlet_id: outlet, p_shift_id: shift, p_cash_account_id: account,
      p_items: [{ variant_id: variant, quantity: 1 }], p_idempotency_key: randomUUID() };

    await t.test('verified JWT identities enforce tenant isolation and ignore signup role metadata', async () => {
      for (const table of ['products','outlets','organization_members','financial_accounts']) {
        assert.deepEqual((await api('ownerB', `${table}?organization_id=eq.${org}&select=id`)).data, []);
        assert.deepEqual((await api('outsider', `${table}?organization_id=eq.${org}&select=id`)).data, []);
      }
      const denied = await api('ownerB', 'products', { method: 'POST', body: { organization_id: org, name: 'Foreign' }, allowError: true });
      assert.equal(denied.data.code, '42501');
      const update = await api('ownerB', `products?id=eq.${product}`, { method: 'PATCH', body: { name: 'Tamper' } });
      assert.deepEqual(update.data, []);
      const fk = await api('ownerB', 'product_variants', { method: 'POST', body: { organization_id: orgB,
        product_id: product, unit_id: unit, sku: 'BAD', name: 'BAD', price: 1 }, allowError: true });
      assert.equal(fk.data.code, '23503');
      const roles = await api('cashier', 'rpc/set_member', { method: 'POST', body: {
        p_organization_id: org, p_user_id: actors.cashier.id, p_role: 'owner' }, allowError: true });
      assert.equal(roles.data.code, '42501');
      assert.deepEqual((await api('cashier', `outlets?id=eq.${outlet2}`)).data, []);
      const anonymous = await request('/rest/v1/products?select=id', { allowError: true });
      assert.equal(anonymous.data.code, '42501');
    });

    await t.test('concurrent duplicate checkout posts one payment and one stock deduction', async () => {
      const results = await Promise.all([rpc('cashier', 'checkout', sale), rpc('cashier', 'checkout', sale)]);
      assert.equal(results[0], results[1]);
      const payments = (await api('finance_staff', `payments?order_id=eq.${results[0]}`)).data;
      assert.equal(payments.length, 1);
      assert.equal(Number(payments[0].amount), 25000);
      assert.equal((await api('inventory_staff', `inventory_movements?reference_id=eq.${results[0]}`)).data.length, 1);
    });

    await t.test('concurrent orders cannot oversell the last unit', async () => {
      await rpc('inventory_staff', 'adjust_inventory', { p_organization_id: org, p_outlet_id: outlet,
        p_variant_id: variant, p_quantity: 1, p_reason: 'One more unit' });
      const results = await Promise.all([1, 2].map(() => api('cashier', 'rpc/checkout', {
        method: 'POST', body: { ...sale, p_idempotency_key: randomUUID() }, allowError: true })));
      assert.equal(results.filter(r => r.response.ok).length, 1);
      assert.equal(results.filter(r => r.data?.code === '23514').length, 1);
    });

    await t.test('v2 hold/split settlement/finalization uses JWT role, tenant and durable idempotency',async()=>{
      await rpc('inventory_staff','adjust_inventory',{p_organization_id:org,p_outlet_id:outlet,p_variant_id:variant,p_quantity:2,p_reason:'V2 split fixture'});
      const bank=await insert('owner','cash_accounts',{organization_id:org,outlet_id:outlet,name:'Settlement bank',kind:'bank'});
      const held=await rpc('cashier','hold_order',{p_organization_id:org,p_outlet_id:outlet,p_shift_id:shift,p_idempotency_key:randomUUID(),p_items:[{variant_id:variant,quantity:1,note:'API integration'}]});
      const args={p_order_id:held,p_idempotency_key:randomUUID(),p_payments:[{cash_account_id:account,method:'cash',amount:10000,tendered_amount:20000},{cash_account_id:bank,method:'qris',amount:15000}]};
      const result=await Promise.all([rpc('cashier','finalize_pos_order',args),rpc('cashier','finalize_pos_order',args)]);assert.equal(result[0],result[1]);
      assert.deepEqual((await api('ownerB',`pos_payment_attempts?order_id=eq.${held}`)).data,[]);
      const foreign=await api('ownerB','rpc/finalize_pos_order',{method:'POST',body:args,allowError:true});assert.equal(foreign.data.code,'42501');
      const attempts=(await api('cashier',`pos_payment_attempts?order_id=eq.${held}`)).data;assert.equal(attempts.length,2);const pending=attempts.find(a=>a.method==='qris');assert.equal(pending.status,'pending');
      const resolve={p_attempt_id:pending.id,p_status:'paid',p_settlement_reference:randomUUID(),p_note:'Matched actual settlement'};
      const denied=await api('cashier','rpc/resolve_payment_attempt',{method:'POST',body:resolve,allowError:true});assert.equal(denied.data.code,'42501');
      await rpc('finance_staff','resolve_payment_attempt',resolve);await rpc('finance_staff','resolve_payment_attempt',resolve);
      const finish={p_order_id:held,p_idempotency_key:randomUUID(),p_payments:[]};await rpc('cashier','finalize_pos_order',finish);await rpc('cashier','finalize_pos_order',finish);
      const [order]=(await api('cashier',`orders?id=eq.${held}`)).data;assert.equal(order.status,'completed');assert.equal(order.payment_status,'paid');assert.equal((await api('cashier',`payments?order_id=eq.${held}`)).data.length,2);
    });

    await t.test('audit/journal protection and immediate membership revocation survive API access', async () => {
      for (const table of ['audit_logs','journal_entries','journal_lines','inventory_balances','payments']) {
        const result = await api('owner', table, { method: 'POST', body: {}, allowError: true });
        assert.equal(result.data.code, '42501', table);
      }
      assert.ok((await api('finance_staff', `journal_entries?organization_id=eq.${org}`)).data.length > 0);
      assert.deepEqual((await api('cashier', `journal_entries?organization_id=eq.${org}`)).data, []);
      await rpc('owner', 'set_member', { p_organization_id: org, p_user_id: actors.inventory_staff.id,
        p_role: 'inventory_staff', p_outlet_id: outlet, p_is_active: false });
      const denied = await api('inventory_staff', 'rpc/adjust_inventory', { method: 'POST', body: {
        p_organization_id: org, p_outlet_id: outlet, p_variant_id: variant, p_quantity: 1, p_reason: 'Revoked' }, allowError: true });
      assert.equal(denied.data.code, '42501');
    });
    // Fixtures are deliberately retained in this disposable local database for
    // inspection. No deletion/reset or hosted access is performed by this test.
  });
