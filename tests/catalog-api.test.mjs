import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';
import { createRequire } from 'node:module';
const { createClient }=createRequire(new URL('../frontend/package.json',import.meta.url))('@supabase/supabase-js');
const source=await readFile(new URL('../frontend/src/lib/catalog-api.ts',import.meta.url),'utf8');
const js=ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext});
async function apiFor(fetch) {
  const key=`catalog_test_${randomUUID()}`;
  globalThis[key]=createClient('https://development.supabase.co','sb_publishable_development_public_key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch},
  });
  try{return await import(`data:text/javascript;base64,${Buffer.from(js.replace('import { supabase } from "@/lib/supabase";',`const supabase=globalThis[${JSON.stringify(key)}];`)).toString('base64')}`);}
  finally{delete globalThis[key];}
}
const json=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json','content-range':'20-39/60'}});
test('catalog service uses server range/count, organization/outlet filters and literal wildcard escaping',async()=>{
  const calls=[];const api=await apiFor(async(url)=>{calls.push(new URL(url));return json([])});
  const org=randomUUID(),outlet=randomUUID();
  const page=await api.readPage('inventory_movements',org,2,{outlet,search:'50%_\\','searchColumn':'note'});
  assert.equal(page.count,60);assert.equal(calls[0].searchParams.get('offset'),'20');assert.equal(calls[0].searchParams.get('limit'),'20');
  assert.equal(calls[0].searchParams.get('organization_id'),`eq.${org}`);assert.equal(calls[0].searchParams.get('outlet_id'),`eq.${outlet}`);
  assert.equal(calls[0].searchParams.get('note'),'ilike.%50\\%\\_\\\\%');
});
test('stock response validation rejects invalid payload instead of showing zero balances',async()=>{
  const api=await apiFor(async()=>json({count:1,rows:[{id:randomUUID(),quantity:'not a number'}]}));
  await assert.rejects(()=>api.stockPage(randomUUID(),randomUUID(),null,'',false,1),/tidak valid/);
});
test('stock RPC preserves authorization errors and idempotency keys; no automatic network retries',async()=>{
  const calls=[];const api=await apiFor(async(url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({code:'42501',message:'Access denied'}),{status:403,headers:{'content-type':'application/json'}})});
  const args={p_request_key:randomUUID(),p_kind:'outgoing'};
  await assert.rejects(()=>api.rpc('mutate_stock',args),e=>e.code==='42501');assert.deepEqual(calls,[args]);
});
test('CSV export fetches every server page, escapes quotes/formulas and propagates partial export failure',async()=>{
  const api=await apiFor(async()=>json([]));const pages=[];
  assert.deepEqual(await api.collectPages(async page=>{pages.push(page);return {count:3,rows:page===1?[1,2]:[3]}}),[1,2,3]);assert.deepEqual(pages,[1,2]);
  const csv=api.toCsv([['name','value'],['=HYPERLINK("bad")',-3],['line\nbreak','a,b']]);
  assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));assert.ok(csv.includes('"-3"'));assert.ok(csv.includes('"line\nbreak","a,b"'));
  await assert.rejects(()=>api.collectPages(async page=>{if(page===2)throw new Error('connection lost');return {count:2,rows:[1]}}),/connection lost/);
});
