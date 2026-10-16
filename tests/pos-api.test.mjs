import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import { createRequire } from 'node:module';

const { createClient } = createRequire(new URL('../frontend/package.json', import.meta.url))('@supabase/supabase-js');

const source = await readFile(new URL('../frontend/src/lib/pos-api.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
async function moduleFor(client) {
  const key = `pos_test_${randomUUID()}`;
  globalThis[key] = client;
  try {
    const isolated = js.replace('import { supabase } from "@/lib/supabase";', `const supabase = globalThis[${JSON.stringify(key)}];`);
    return await import(`data:text/javascript;base64,${Buffer.from(isolated).toString('base64')}`);
  } finally { delete globalThis[key]; }
}
function clientFor(fetch) {
  return createClient('https://development.supabase.co', 'sb_publishable_development_public_key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
}
const args = () => ({ p_organization_id: randomUUID(), p_outlet_id: randomUUID(), p_shift_id: randomUUID(),
  p_idempotency_key: randomUUID(), p_cash_account_id: randomUUID(), p_items: [{ variant_id: randomUUID(), quantity: 1 }] });

test('checkout sends the typed RPC payload and preserves the caller idempotency key', async () => {
  const calls = [];
  const order = randomUUID();
  const api = await moduleFor(clientFor(async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(order), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  const input = args();
  assert.equal(await api.checkout(input), order);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://development.supabase.co/rest/v1/rpc/checkout');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, input);
});

test('checkout surfaces database denials without creating a new request', async () => {
  const api = await moduleFor(clientFor(async () => new Response(JSON.stringify({ code: '42501', message: 'Access denied' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } })));
  await assert.rejects(() => api.checkout(args()), e => e.code === '42501');
});

test('network failure is reported to the caller and checkout is not silently retried', async () => {
  let calls = 0;
  const api = await moduleFor(clientFor(async () => { calls++; throw new TypeError('fetch failed'); }));
  await assert.rejects(() => api.checkout(args()), e => e.message.includes('fetch failed'));
  assert.equal(calls, 1);
});

test('product loading preserves server errors rather than returning an empty successful list', async () => {
  const api = await moduleFor(clientFor(async () => new Response(JSON.stringify({ code: '503', message: 'Database unavailable' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } })));
  await assert.rejects(() => api.listProducts(randomUUID()), e => e.message === 'Database unavailable');
});

test('unconfigured clients and missing authentication produce explicit errors', async () => {
  const empty = await moduleFor(null);
  await assert.rejects(() => empty.checkout(args()), /belum dikonfigurasi/);
  const signedOut = await moduleFor({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
  await assert.rejects(() => signedOut.getMyMemberships(), /login terlebih dahulu/);
});

test('new POS wrappers preserve exact RPC keys/payload and catalog validates numeric values', async () => {
  const calls=[]; const order=randomUUID();
  const api=await moduleFor(clientFor(async(url,options)=>{calls.push({url:String(url),body:options.body&&JSON.parse(options.body)});return new Response(JSON.stringify(order),{status:200,headers:{'Content-Type':'application/json'}})}));
  const input={p_order_id:order,p_payments:[{method:'cash',amount:100,cash_account_id:randomUUID(),tendered_amount:200}],p_idempotency_key:randomUUID()};
  await api.finalizePosOrder(input);assert.deepEqual(calls[0].body,input);assert.ok(calls[0].url.endsWith('/rpc/finalize_pos_order'));
  const invalid=await moduleFor(clientFor(async()=>new Response(JSON.stringify({count:1,rows:[{id:randomUUID(),product_id:randomUUID(),product_name:'Coffee',variant_name:'Cup',sku:'C',price:'100',photo_url:null,sale_quantity:1,consumption_mode:'stock',available:1}]}),{status:200,headers:{'Content-Type':'application/json'}})));
  await assert.rejects(()=>invalid.posCatalog(randomUUID(),randomUUID()),/price/);
});

test('history uses server pagination, literal search, date bounds and separate payment status',async()=>{
  let url;const api=await moduleFor(clientFor(async input=>{url=new URL(input);return new Response('[]',{status:200,headers:{'Content-Type':'application/json','content-range':'20-19/0'}})}));
  await api.orderHistory('org','outlet',2,{search:'POS_%',from:'2026-10-15T17:00:00Z',until:'2026-10-16T17:00:00Z',payment:'partial',openOnly:true});
  assert.equal(url.searchParams.get('offset'),'20');assert.equal(url.searchParams.get('limit'),'20');assert.equal(url.searchParams.get('receipt_number'),'ilike.%POS\\_\\%%');assert.equal(url.searchParams.get('payment_status'),'eq.partial');assert.deepEqual(url.searchParams.getAll('created_at'),['gte.2026-10-15T17:00:00Z','lt.2026-10-16T17:00:00Z']);assert.equal(url.searchParams.get('status'),'in.(held,pending)');
});

test('order detail reads all pages and propagates child query failure',async()=>{
  const calls=[];const api=await moduleFor(clientFor(async input=>{const u=new URL(input);calls.push(u);const table=u.pathname.split('/').at(-1);let data=table==='orders'?{id:'order'}:table==='pos_payment_attempts'&&u.searchParams.get('offset')==='0'?Array.from({length:500},(_,i)=>({id:String(i)})):[];return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}})}));
  const result=await api.orderDetail('org','outlet','order');assert.equal(result.attempts.length,500);assert.ok(calls.some(u=>u.pathname.endsWith('/pos_payment_attempts')&&u.searchParams.get('offset')==='500'));assert.ok(calls.every(u=>u.searchParams.get('organization_id')==='eq.org'&&u.searchParams.get('outlet_id')==='eq.outlet'));
  const bad=await moduleFor(clientFor(async input=>new Response(JSON.stringify(String(input).includes('/refunds?')?{code:'42501',message:'Denied refund read'}:String(input).includes('/orders?')?{id:'order'}:[]),{status:String(input).includes('/refunds?')?403:200,headers:{'Content-Type':'application/json'}})));
  await assert.rejects(()=>bad.orderDetail('org','outlet','order'),e=>e.code==='42501');
});
