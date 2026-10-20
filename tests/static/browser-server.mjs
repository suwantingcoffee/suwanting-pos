// Local integration harness: real migration/RPC transactions; Auth HTTP is a test double.
// Never deploy this server. Production uses Supabase Auth and PostgREST.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { startDatabase, owner, cashier, inactive, admin } from './database-runtime.mjs';

const db = await startDatabase(); await db.reset();
const root = resolve('dist');
const users = { 'owner@example.test': owner, 'cashier@example.test': cashier, 'inactive@example.test': inactive, 'admin@example.test': admin };
const tokens = new Map();
let loseCheckout = false;
const token = id => { const access = [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url'), 'test-signature'].join('.'); tokens.set(access, id); return access; };
const session = (id, email) => ({ access_token: token(id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'test-refresh-' + id, user: { id, email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() } });
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const readBody = async req => { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text || '{}'); };

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        const id = tokens.get((req.headers.authorization || '').replace(/^Bearer /, '')) || null;
        if (url.pathname === '/__test/health') return send(res, 200, { ready: true });
        if (url.pathname === '/__test/shutdown' && req.method === 'POST') { stopping = true; await db.stop(); send(res, 200, {}); server.close(() => process.exit(0)); return; }
        if (url.pathname === '/__test/reset' && req.method === 'POST') { await db.reset(); tokens.clear(); loseCheckout = false; return send(res, 200, {}); }
        if (url.pathname === '/__test/lose-checkout' && req.method === 'POST') { loseCheckout = true; return send(res, 200, {}); }
        if (url.pathname === '/__test/restore-response' && req.method === 'POST') { loseCheckout = false; return send(res, 200, {}); }
        if (url.pathname === '/__test/state') {
            const stock = (await db.pool.query('select stock_quantity from suwanting_pos.ingredients where id=1')).rows[0].stock_quantity;
            const sales = (await db.pool.query('select count(*)::int count from suwanting_pos.sales')).rows[0].count;
            const movements = (await db.pool.query('select count(*)::int count from suwanting_pos.stock_movements')).rows[0].count;
            return send(res, 200, { stock, sales, movements });
        }
        if (url.pathname === '/auth/v1/token') {
            const data = await readBody(req); const user = users[data.email];
            if (url.searchParams.get('grant_type') === 'refresh_token') { const userId = String(data.refresh_token).replace('test-refresh-', ''); const email = Object.keys(users).find(key => users[key] === userId); if (email) return send(res, 200, session(userId, email)); }
            if (!user || data.password !== 'TestOnly!2026') return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
            return send(res, 200, session(user, data.email));
        }
        if (url.pathname === '/auth/v1/user') { if (!id) return send(res, 401, { msg: 'Invalid token' }); return send(res, 200, { id, email: Object.keys(users).find(key => users[key] === id), aud: 'authenticated', user_metadata: {} }); }
        if (url.pathname === '/auth/v1/logout') { res.writeHead(204); return res.end(); }
        if (url.pathname === '/auth/v1/recover') return send(res, 200, {});
        if (url.pathname.startsWith('/rest/v1/rpc/scpos_')) {
            const name = url.pathname.slice('/rest/v1/rpc/scpos_'.length); const args = await readBody(req);
            try {
                const result = await db.rpc(id, name, args);
                if (name === 'checkout' && loseCheckout) return req.socket.destroy();
                return send(res, 200, result);
            } catch (error) { return send(res, error.code === '42501' ? 403 : 400, { code: error.code, message: error.message, details: null, hint: null }); }
        }
        if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/rest/')) return send(res, 403, { message: 'Forbidden test route' });
        if (!url.pathname.startsWith('/suwanting-pos/')) return send(res, 404, {});
        const file = resolve(root, decodeURIComponent(url.pathname.slice('/suwanting-pos/'.length)) || 'index.html');
        if (!file.startsWith(root + sep)) return send(res, 403, {});
        try {
            const content = await readFile(file); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.sql': 'text/plain; charset=utf-8' };
            res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(content);
        } catch { send(res, 404, {}); }
    } catch (error) { send(res, 500, { message: error.message }); }
});
server.listen(4175, '127.0.0.1');
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; server.close(); await db.stop(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
