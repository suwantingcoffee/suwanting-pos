import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotals, decimalUnits, csv, routeFromHash, definitiveFailure } from '../../resources/js/domain.js';
import { validateConfig } from '../../resources/js/config.js';
import { createUserHandler } from '../../supabase/functions/_shared/create-user.js';
import { validatePhoto } from '../../resources/js/backend.js';

test('image validation accepts PNG signature and rejects spoofed MIME, SVG, empty or oversized files', async () => {
    await validatePhoto(new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'avatar.png', {type:'image/png'}));
    await assert.rejects(validatePhoto(new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'})));
    await assert.rejects(validatePhoto(new File(['<html>'],'bad.png',{type:'image/png'})));
    await assert.rejects(validatePhoto(new File([],'empty.png',{type:'image/png'})));
    await assert.rejects(validatePhoto(new File([new Uint8Array(2097153)],'big.png',{type:'image/png'})));
});

test('currency and recipe decimals reject exponent notation, negatives, overprecision and unsafe values', () => {
    assert.equal(decimalUnits('18.125', 3), 18125);
    assert.equal(decimalUnits('24000.29'), 2400029);
    for (const invalid of ['-1', '1e2', 'NaN', '1.001', '1000000000', '1,23', '']) assert.throws(() => decimalUnits(invalid));
});
test('cart computes tax after discount, rounds half up, and respects tax switch', () => {
    const lines = [{ unit_price: '24000', quantity: 2 }];
    assert.deepEqual(cartTotals(lines, '3000', { tax_enabled: true, tax_rate: '11' }), { subtotal: 48000, discount: 3000, tax: 4950, total: 49950 });
    assert.equal(cartTotals(lines, '0', { tax_enabled: false, tax_rate: '11' }).total, 48000);
    assert.equal(cartTotals([{ unit_price: '0.05', quantity: 1 }], 0, { tax_enabled: true, tax_rate: '10' }).total, 0.06);
});
test('CSV escapes delimiters and spreadsheet formulas while preserving numeric negatives', () => {
    const output = csv([{ name: '=CMD("x")', quantity: -1 }, { name: 'Nama,\nBaru', quantity: 3 }], [{ key: 'name', label: 'Nama' }, { key: 'quantity', label: 'Jumlah' }]);
    assert.equal(output, '\uFEFF"Nama","Jumlah"\r\n"\'=CMD(""x"")","-1"\r\n"Nama,\nBaru","3"');
});
test('hash routes support deep links on GitHub project pages', () => {
    const route = routeFromHash('#/sale/42?print=1');
    assert.equal(route.page, 'sale'); assert.equal(route.id, '42'); assert.equal(route.query.get('print'), '1');
    assert.equal(routeFromHash('').page, 'dashboard');
});
test('only definite database rejection permits changing a pending checkout', () => {
    assert.equal(definitiveFailure({ code: '23514' }), true);
    for (const code of [undefined, '503', 'P0001', 'FetchError']) assert.equal(definitiveFailure({ code }), false);
});
test('browser config accepts public keys and rejects secrets and unsafe URLs', () => {
    const key = 'sb_publishable_abcdefghijklmnopqrstu';
    assert.equal(validateConfig('https://example.supabase.co', key).url, 'https://example.supabase.co');
    assert.equal(validateConfig('http://127.0.0.1:4175', key).url, 'http://127.0.0.1:4175');
    for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?x=1']) assert.throws(() => validateConfig(url, key));
    assert.throws(() => validateConfig('https://example.com', 'sb_secret_abcdefghijklmnopqrstu'));
    const service = 'eyJ.' + btoa(JSON.stringify({ role: 'service_role' })) + '.signature';
    assert.throws(() => validateConfig('https://example.com', service));
});

const userData = () => ({ name: 'Kasir Baru', email: 'cashier@example.test', password: 'TestOnly!2026', role: 'cashier', is_active: true, can_manage_catalog: false, can_discount: false });
function edgeFixture({ role = 'owner', active = true, validToken = true, failSave = false, failDelete = false, failUpdate = false } = {}) {
    const events = [];
    const caller = {
        auth: { getUser: async () => ({ data: { user: validToken ? { id: 'owner' } : null }, error: validToken ? null : {} }) },
        rpc: async (name, args) => {
            events.push({ name, args });
            if (name === 'scpos_bootstrap') return { data: { profile: { role, is_active: active } } };
            return failSave ? { error: { message: 'DB failure' } } : { data: { id: 'new-id', role: args.p_data.role } };
        },
    };
    const admin = { auth: { admin: {
        createUser: async data => { events.push({ name: 'create', data }); return { data: { user: { id: 'new-id' } } }; },
        deleteUser: async id => { events.push({ name: 'delete', id }); return { error: failDelete ? {} : null }; },
        getUserById: async id => { events.push({ name: 'target', id }); return { data: { user: { id } } }; },
        updateUserById: async (id, data) => { events.push({ name: 'update', id, data }); return { error: failUpdate ? {} : null }; },
    } } };
    const handler = createUserHandler({ createClient: (_, key) => key === 'server-only' ? admin : caller, url: 'https://example.supabase.co', publicKey: 'public', serviceKey: 'server-only', allowedOrigins: ['https://suwantingcoffee.github.io'] });
    const request = (data = userData(), headers = {}) => new Request('https://example.supabase.co/functions/v1/scpos-create-user', { method: 'POST', headers: { Origin: 'https://suwantingcoffee.github.io', Authorization: 'Bearer session-token', ...headers }, body: JSON.stringify(data) });
    return { handler, request, events };
}
test('user creation requires verified session and current active owner before admin API', async () => {
    for (const fixture of [{ validToken: false }, { role: 'cashier' }, { role: 'owner', active: false }]) {
        const { handler, request, events } = edgeFixture(fixture); const response = await handler(request());
        assert.equal(response.status, fixture.validToken === false ? 401 : 403);
        assert.equal(events.some(event => event.name === 'create'), false);
    }
});
test('user creation validates input, does not trust metadata role and omits password from profile RPC/response', async () => {
    const { handler, request, events } = edgeFixture();
    assert.equal((await handler(request({ ...userData(), role: 'superuser' }))).status, 422);
    assert.equal((await handler(request({ ...userData(), id: 'spoofed' }))).status, 422);
    assert.equal((await handler(request(userData(), { Origin: 'https://evil.example' }))).status, 403);
    const response = await handler(request()); assert.equal(response.status, 201);
    assert.equal((await response.text()).includes(userData().password), false);
    const created = events.find(event => event.name === 'create');
    assert.deepEqual(created.data.user_metadata, { name: 'Kasir Baru' });
    const saved = events.find(event => event.name === 'scpos_save'); assert.equal('password' in saved.args.p_data, false);
});
test('failed profile write compensates Auth creation and reports uncertain cleanup', async () => {
    for (const failDelete of [false, true]) {
        const { handler, request, events } = edgeFixture({ failSave: true, failDelete });
        assert.equal((await handler(request())).status, failDelete ? 502 : 500);
        assert.deepEqual(events.at(-1), { name: 'delete', id: 'new-id' });
    }
});

test('owner can change Auth email/password after profile validation; empty password is omitted', async () => {
    for (const password of ['', 'NewTestOnly!2026']) {
        const { handler, request, events } = edgeFixture();
        const data = { ...userData(), id: '20000000-0000-4000-8000-000000000001', operation: 'update', password };
        const response = await handler(request(data)); assert.equal(response.status, 200);
        assert.ok(events.findIndex(event => event.name === 'scpos_save') < events.findIndex(event => event.name === 'update'));
        const update = events.find(event => event.name === 'update');
        assert.equal(update.data.email, data.email); assert.equal('password' in update.data, !!password);
        assert.equal(events.some(event => event.name === 'create'), false);
    }
});
test('profile rejection stops Auth edits; Auth failure explicitly reports persisted profile changes', async () => {
    const data = { ...userData(), id: '20000000-0000-4000-8000-000000000001', operation: 'update' };
    const rejected = edgeFixture({ failSave: true });
    assert.equal((await rejected.handler(rejected.request(data))).status, 422);
    assert.equal(rejected.events.some(event => event.name === 'update'), false);
    const partial = edgeFixture({ failUpdate: true });
    const response = await partial.handler(partial.request(data));
    assert.equal(response.status, 502); assert.match((await response.json()).error, /Izin pengguna tersimpan/);
});
