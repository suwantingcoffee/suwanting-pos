import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {migratedDatabase,asUser} from './helpers.mjs';
import {fixture} from './fixtures.mjs';
let db,f;
before(async()=>{db=await migratedDatabase();f=await fixture(db)});
after(async()=>await db?.close());
const denied=(work,code)=>assert.rejects(work,e=>e.code===code);
async function variant(stock=10,price=25000){
  const p=await f.insert('products',{organization_id:f.org,name:'POS coffee '+randomUUID()});
  const v=await f.insert('product_variants',{organization_id:f.org,product_id:p,unit_id:f.unit,name:'Regular',sku:randomUUID(),price,acquisition_cost:5000});
  if(stock)await f.rpc('owner','adjust_inventory',{p_organization_id:f.org,p_outlet_id:f.outlet,p_variant_id:v,p_quantity:stock,p_reason:'POS opening'});
  return v;
}
const holdArgs=(v,extra={})=>({p_organization_id:f.org,p_outlet_id:f.outlet,p_shift_id:f.shift,p_idempotency_key:randomUUID(),p_items:JSON.stringify([{variant_id:v,quantity:1,note:'No sugar'}]),...extra});
const finish=(order,parts,key=randomUUID(),user='cashier')=>f.rpc(user,'finalize_pos_order',{p_order_id:order,p_payments:JSON.stringify(parts),p_idempotency_key:key});
const cash=(amount,tender=amount)=>({cash_account_id:f.account,method:'cash',amount,tendered_amount:tender});
const electronic=(amount,method='qris')=>({cash_account_id:f.accountBank,method,amount});
const order=async(id)=>(await f.query('cashier','select * from public.orders where id=$1',[id]))[0];
const qty=async(v)=>Number((await f.query('owner','select quantity from public.inventory_balances where outlet_id=$1 and variant_id=$2',[f.outlet,v]))[0]?.quantity??0);
const attempts=id=>f.query('cashier','select * from public.pos_payment_attempts where order_id=$1 order by created_at,id',[id]);

test('trusted totals, promotion, tax, item snapshots and server change; hold/resume never consumes stock',async()=>{
  await f.query('owner','update public.outlets set pos_tax_percent=11 where id=$1',[f.outlet]);
  const v=await variant();const args=holdArgs(v,{p_promotion_code:'DEV10',p_customer_id:f.customer,p_items:JSON.stringify([{variant_id:v,quantity:2,note:'Less ice'}])});
  const id=await f.rpc('cashier','hold_order',args);let o=await order(id);
  assert.equal(o.subtotal,'50000.00');assert.equal(o.discount,'5000.00');assert.equal(o.tax,'4950.00');assert.equal(o.total,'49950.00');assert.equal(await qty(v),10);
  await f.rpc('cashier','resume_order',{p_order_id:id,p_shift_id:f.shift,p_expected_revision:o.revision});
  await denied(()=>f.rpc('cashier','resume_order',{p_order_id:id,p_shift_id:f.shift,p_expected_revision:o.revision}),'40001');
  await f.query('owner','update public.product_variants set price=99000,name=$1 where id=$2',['Changed',v]);
  await finish(id,[cash(49950,50000)]);o=await order(id);
  assert.equal(o.status,'completed');assert.equal(o.payment_status,'paid');assert.equal(o.total,'49950.00');assert.equal(await qty(v),8);
  const [line]=await f.query('cashier','select * from public.order_items where order_id=$1',[id]);assert.equal(line.unit_price,'25000.00');assert.equal(line.note,'Less ice');assert.equal(line.variant_name,'Regular');assert.ok(line.sku_snapshot);
  const [pay]=await f.query('cashier','select * from public.payments where order_id=$1',[id]);assert.equal(pay.change_amount,'50.00');
  assert.equal(o.receipt_snapshot.customer,'Development customer');
  await f.query('owner','update public.outlets set pos_tax_percent=0 where id=$1',[f.outlet]);
});

test('split cash/QRIS stays partial until authorized settlement; finalization and journal are separate from settlement',async()=>{
  const v=await variant();const id=await f.rpc('cashier','hold_order',holdArgs(v));
  await finish(id,[cash(10000),electronic(15000)]);assert.equal((await order(id)).payment_status,'partial');assert.equal(await qty(v),10);
  const a=(await attempts(id)).find(a=>a.method==='qris');
  const resolve={p_attempt_id:a.id,p_status:'paid',p_settlement_reference:randomUUID(),p_note:'Matched actual bank settlement'};
  await denied(()=>f.rpc('cashier','resolve_payment_attempt',resolve),'42501');
  await denied(()=>f.rpc('owner','resolve_payment_attempt',{...resolve,p_settlement_reference:null}),'22023');
  await f.rpc('finance_staff','resolve_payment_attempt',resolve);await f.rpc('finance_staff','resolve_payment_attempt',resolve);
  assert.equal((await order(id)).payment_status,'paid');assert.equal((await order(id)).status,'pending');assert.equal(await qty(v),10);
  await finish(id,[]);assert.equal((await order(id)).status,'completed');assert.equal(await qty(v),9);
  assert.equal((await f.query('cashier','select id from public.payments where order_id=$1',[id])).length,2);
  const net=await f.query('finance_staff',`select a.code,sum(l.debit-l.credit) net from public.journal_lines l join public.financial_accounts a on a.id=l.financial_account_id join public.journal_entries e on e.id=l.journal_entry_id where e.idempotency_key=any($1::uuid[]) group by a.code`,[[...(await attempts(id)).map(a=>a.id),id]]);
  assert.equal(Number(net.find(x=>x.code==='2100-POS').net),0);
});

test('failed electronic attempt persists failure without stock/cash; replacement payment can retry',async()=>{
  const v=await variant();const id=await f.rpc('cashier','hold_order',holdArgs(v));await finish(id,[electronic(25000,'card')]);const [a]=await attempts(id);
  await f.rpc('manager','resolve_payment_attempt',{p_attempt_id:a.id,p_status:'failed',p_note:'Acquirer declined'});
  assert.equal((await order(id)).payment_status,'failed');assert.equal(await qty(v),10);assert.equal((await f.query('cashier','select id from public.payments where order_id=$1',[id])).length,0);
  await finish(id,[cash(25000)]);assert.equal((await order(id)).payment_status,'paid');
});

test('insufficient stock rolls back attempts, payments, cash, journal and consumption atomically',async()=>{
  const v=await variant(1);const id=await f.rpc('cashier','hold_order',holdArgs(v,{p_items:JSON.stringify([{variant_id:v,quantity:2}])}));
  const before=(await db.query('select count(*)::int n from public.journal_entries')).rows[0].n;
  await denied(()=>finish(id,[cash(50000)]),'23514');assert.equal((await order(id)).status,'held');assert.equal((await attempts(id)).length,0);assert.equal(await qty(v),1);
  assert.equal((await db.query('select count(*)::int n from public.journal_entries')).rows[0].n,before);
  assert.equal((await f.query('owner','select id from public.inventory_movements where reference_id=$1',[id])).length,0);
});

test('confirmed settlement survives failed fulfillment and can be refunded without inventing a sale',async()=>{
  const v=await variant(0);const id=await f.rpc('cashier','hold_order',holdArgs(v));await finish(id,[electronic(25000)]);const [a]=await attempts(id);
  await f.rpc('owner','resolve_payment_attempt',{p_attempt_id:a.id,p_status:'paid',p_settlement_reference:randomUUID(),p_note:'Verified settlement'});
  await denied(()=>finish(id,[]),'23514');assert.equal((await order(id)).payment_status,'paid');assert.equal((await order(id)).status,'pending');
  const [pay]=await f.query('cashier','select id from public.payments where order_id=$1',[id]);
  await f.rpc('owner','refund_pos_payment',{p_payment_id:pay.id,p_amount:25000,p_reason:'Unavailable stock',p_idempotency_key:randomUUID(),p_settlement_reference:randomUUID()});
  assert.equal((await order(id)).payment_status,'refunded');assert.equal(await qty(v),0);
  await f.rpc('owner','void_order',{p_order_id:id,p_reason:'Unavailable stock'});assert.equal((await order(id)).status,'voided');
});

test('double submission returns one order/payment; payload/key mismatch and over-allocation fail',async()=>{
  const v=await variant();const args=holdArgs(v);const id=await f.rpc('cashier','hold_order',args);assert.equal(await f.rpc('cashier','hold_order',args),id);
  await denied(()=>f.rpc('cashier','hold_order',{...args,p_customer_id:f.customer}),'22023');
  const key=randomUUID();await finish(id,[cash(25000)],key);await finish(id,[cash(25000)],key);assert.equal(await qty(v),9);assert.equal((await attempts(id)).length,1);
  await denied(()=>finish(id,[cash(24000)],key),'22023');
  const next=await f.rpc('cashier','hold_order',holdArgs(v));await denied(()=>finish(next,[cash(10000),cash(16000)]),'22023');assert.equal((await attempts(next)).length,0);
  await denied(()=>finish(next,[cash(25000,20000)]),'22023');
});

test('refund original payment, cap per part, reverse tax, audit and preserve completed stock history',async()=>{
  const v=await variant();const id=await f.rpc('cashier','hold_order',holdArgs(v));await finish(id,[cash(10000),cash(15000)]);
  const pays=await f.query('cashier','select id,amount from public.payments where order_id=$1 order by amount',[id]);
  const args={p_payment_id:pays[0].id,p_amount:10000,p_reason:'Customer return',p_idempotency_key:randomUUID()};
  await denied(()=>f.rpc('cashier','refund_pos_payment',args),'42501');
  const r=await f.rpc('manager','refund_pos_payment',args);assert.equal(await f.rpc('manager','refund_pos_payment',args),r);assert.equal((await order(id)).payment_status,'partially_refunded');
  await denied(()=>f.rpc('manager','refund_pos_payment',{...args,p_idempotency_key:randomUUID(),p_amount:1}),'22023');
  await f.rpc('finance_staff','refund_pos_payment',{...args,p_payment_id:pays[1].id,p_amount:15000,p_idempotency_key:randomUUID()});assert.equal((await order(id)).payment_status,'refunded');assert.equal((await order(id)).status,'completed');assert.equal(await qty(v),9);
  await denied(()=>f.rpc('owner','void_order',{p_order_id:id,p_reason:'Wrong action'}),'22023');
});

test('tenant/outlet isolation, spoofed totals, direct writes and unauthorized void are rejected',async()=>{
  const v=await variant();const id=await f.rpc('cashier','hold_order',holdArgs(v));
  await denied(()=>f.rpc('ownerB','finalize_pos_order',{p_order_id:id,p_payments:'[]',p_idempotency_key:randomUUID()}),'42501');
  await denied(()=>f.rpc('ownerB','pos_catalog',{p_organization_id:f.org,p_outlet_id:f.outlet}),'42501');
  await denied(()=>f.rpc('cashier','hold_order',holdArgs(v,{p_items:JSON.stringify([{variant_id:v,quantity:1,price:1}])})),'22023');
  await denied(()=>f.rpc('cashier','void_order',{p_order_id:id,p_reason:'Test void'}),'42501');
  await f.rpc('manager','void_order',{p_order_id:id,p_reason:'Cancelled by customer'});
  assert.equal((await order(id)).status,'voided');assert.equal(await qty(v),10);
  await denied(()=>f.query('owner','update public.pos_payment_attempts set status=$1',['paid']),'42501');
});

test('catalog exposes paginated outlet sellable stock without financial ledger access to cashier',async()=>{
  const page=await f.rpc('cashier','pos_catalog',{p_organization_id:f.org,p_outlet_id:f.outlet,p_page:1});
  assert.ok(page.rows.length<=24);assert.ok(page.count>0);assert.equal(typeof page.rows[0].price,'number');assert.ok('available' in page.rows[0]);
  assert.deepEqual(await f.query('cashier','select id from public.inventory_movements'),[]);
});

test('partial tax refunds use cumulative rounding and full refund exactly reverses tax',async()=>{
  await f.query('owner','update public.outlets set pos_tax_percent=11 where id=$1',[f.outlet]);
  const v=await variant(10,100);const id=await f.rpc('cashier','hold_order',holdArgs(v));await finish(id,[cash(111)]);
  const [pay]=await f.query('cashier','select id from public.payments where order_id=$1',[id]);
  for(const amount of [0.01,54.99,56])await f.rpc('finance_staff','refund_pos_payment',{p_payment_id:pay.id,p_amount:amount,p_reason:'Tax rounding refund',p_idempotency_key:randomUUID()});
  const [totals]=await f.query('finance_staff','select sum(amount) amount,sum(tax_amount) tax from public.refunds where order_id=$1',[id]);
  assert.equal(Number(totals.amount),111);assert.equal(Number(totals.tax),11);assert.equal((await order(id)).payment_status,'refunded');assert.equal(await qty(v),9);
  await f.query('owner','update public.outlets set pos_tax_percent=0 where id=$1',[f.outlet]);
});

test('held recipe saves original unit conversion and version before later recipe edits; consumes only once',async()=>{
  const g=await f.insert('units',{organization_id:f.org,code:'pos-g',name:'POS grams',dimension:'mass',factor_to_base:1});
  const kg=await f.insert('units',{organization_id:f.org,code:'pos-kg',name:'POS kilograms',dimension:'mass',factor_to_base:1000});
  const p=await f.insert('products',{organization_id:f.org,name:'Recipe bean'});
  const bean=await f.insert('product_variants',{organization_id:f.org,product_id:p,name:'Bean',sku:randomUUID(),unit_id:g,price:100});
  await f.rpc('owner','adjust_inventory',{p_organization_id:f.org,p_outlet_id:f.outlet,p_variant_id:bean,p_quantity:1000,p_reason:'Recipe opening'});
  const menu=await variant(0);const base={p_organization_id:f.org,p_recipe_id:null,p_name:'Held espresso',p_output_variant_id:menu,p_yield_quantity:1,p_output_unit_id:f.unit,p_kind:'menu',p_items:JSON.stringify([{variant_id:bean,quantity:0.018,unit_id:kg}])};
  const rec=await f.rpc('owner','save_recipe',base);
  await f.query('owner',"update public.product_variants set consumption_mode='recipe',track_inventory=false,sale_recipe_id=$1 where id=$2",[rec,menu]);
  const id=await f.rpc('cashier','hold_order',holdArgs(menu));
  await f.rpc('owner','save_recipe',{...base,p_recipe_id:rec,p_items:JSON.stringify([{variant_id:bean,quantity:20,unit_id:g}])});
  const key=randomUUID();await finish(id,[cash(25000)],key);await finish(id,[cash(25000)],key);
  assert.equal(await qty(bean),982);assert.equal(await qty(menu),0);
  const [line]=await f.query('cashier','select recipe_snapshot from public.order_items where order_id=$1',[id]);assert.equal(line.recipe_snapshot.recipe.version,1);assert.equal(line.recipe_snapshot.consumptions[0].quantity,18);
});

test('zero-total sale consumes once without payments and still requires a cashier own shift',async()=>{
  const v=await variant(2,0),id=await f.rpc('cashier','hold_order',holdArgs(v));
  await denied(()=>finish(id,[cash(1)]),'22023');
  await denied(()=>finish(id,[],randomUUID(),'manager'),'42501');
  const key=randomUUID();await finish(id,[],key);await finish(id,[],key);assert.equal(await qty(v),1);assert.equal((await order(id)).status,'completed');assert.equal((await attempts(id)).length,0);
});

test('late paid/failed settlement after a partial refund preserves refund status and received-funds facts',async()=>{
  for(const status of ['paid','failed']){
    const v=await variant(),id=await f.rpc('cashier','hold_order',holdArgs(v));await finish(id,[cash(10000),electronic(15000)]);
    const [pay]=await f.query('cashier','select id from public.payments where order_id=$1',[id]);
    await f.rpc('manager','refund_pos_payment',{p_payment_id:pay.id,p_amount:10000,p_reason:'Cancelled before settlement',p_idempotency_key:randomUUID()});
    const a=(await attempts(id)).find(a=>a.method==='qris');await f.rpc('finance_staff','resolve_payment_attempt',{p_attempt_id:a.id,p_status:status,p_settlement_reference:status==='paid'?randomUUID():null,p_note:'Late settlement reconciliation'});
    assert.equal((await order(id)).payment_status,status==='paid'?'partially_refunded':'refunded');assert.equal(await qty(v),10);
    await denied(()=>finish(id,[]),'22023');
    if(status==='paid'){
      const [late]=await f.query('cashier',"select id from public.payments where order_id=$1 and method='qris'",[id]);
      await f.rpc('finance_staff','refund_pos_payment',{p_payment_id:late.id,p_amount:15000,p_reason:'Return late settlement',p_idempotency_key:randomUUID(),p_settlement_reference:randomUUID()});
    }
    await f.rpc('manager','void_order',{p_order_id:id,p_reason:'Cancelled and reconciled'});assert.equal((await order(id)).payment_status,'refunded');
  }
});

test('forward POS migrations preserve populated legacy sale, refund, line, stock and journals',async()=>{
  let uid,org,id,original;
  const isolated=await migratedDatabase({restrictedMigrator:true,onMigration:async(c,file)=>{
    if(!file.includes('01300'))return;
    await c.exec('reset role');uid=randomUUID();await c.query('insert into auth.users(id,email) values($1,$2)',[uid,'pos-upgrade@example.test']);
    const run=(sql,args=[])=>asUser(c,uid,sql,args);const value=async(sql,args)=>(await run(sql,args))[0].id;
    org=await value("select public.create_organization('Upgrade POS') id");
    const outlet=await value("insert into public.outlets(organization_id,name,code) values($1,'Upgrade','UP') returning id",[org]);
    const unit=await value("insert into public.units(organization_id,code,name) values($1,'pcs','Piece') returning id",[org]);
    const product=await value("insert into public.products(organization_id,name) values($1,'Legacy coffee') returning id",[org]);
    const variant=await value("insert into public.product_variants(organization_id,product_id,unit_id,sku,name,price) values($1,$2,$3,'UP','Cup',100) returning id",[org,product,unit]);
    const account=await value("insert into public.cash_accounts(organization_id,outlet_id,name,kind) values($1,$2,'Upgrade drawer','cash') returning id",[org,outlet]);
    await run("select public.adjust_inventory($1,$2,$3,10,'Before upgrade')",[org,outlet,variant]);
    const shift=await value('select public.open_shift($1,$2,$3,0) id',[org,outlet,account]);
    id=await value('select public.checkout($1,$2,$3,$4,$5,$6) id',[org,outlet,shift,randomUUID(),JSON.stringify([{variant_id:variant,quantity:1}]),account]);
    await run("select public.refund_order($1,25,'Before upgrade refund',$2)",[id,randomUUID()]);
    original={};for(const table of ['orders','order_items','payments','refunds','inventory_movements','cash_movements','journal_entries','journal_lines'])original[table]=(await c.query(`select * from public.${table} where organization_id=$1 order by id`,[org])).rows;
    await c.exec('set role pos_migrator');
  }});
  try{
    const [o]=await asUser(isolated,uid,'select * from public.orders where id=$1',[id]);assert.equal(o.pos_version,1);assert.equal(o.payment_status,'partially_refunded');
    for(const [table,rows]of Object.entries(original)){
      const actual=(await isolated.query(`select * from public.${table} where organization_id=$1 order by id`,[org])).rows;assert.equal(actual.length,rows.length,table);
      for(let i=0;i<rows.length;i++)for(const [key,value]of Object.entries(rows[i]))if(!(table==='orders'&&key==='updated_at'))assert.deepEqual(actual[i][key],value,`${table}.${key}`);
    }
    assert.deepEqual((await isolated.query("select policyname from pg_policies where policyname='pos_migration'")).rows,[]);
  }finally{await isolated.close()}
});

test('legacy checkout cannot bypass electronic settlement, outlet tax or inactive products',async()=>{
  const v=await variant();const args={...f.checkoutArgs,p_items:JSON.stringify([{variant_id:v,quantity:1}]),p_promotion_code:null,p_customer_id:null,p_idempotency_key:randomUUID()};
  await denied(()=>f.rpc('cashier','checkout',{...args,p_cash_account_id:f.accountBank}),'22023');
  await f.query('owner','update public.outlets set pos_tax_percent=11 where id=$1',[f.outlet]);
  await denied(()=>f.rpc('cashier','checkout',args),'22023');
  await f.query('owner','update public.outlets set pos_tax_percent=0 where id=$1',[f.outlet]);
  await f.rpc('owner','adjust_inventory',{p_organization_id:f.org,p_outlet_id:f.outlet,p_variant_id:v,p_quantity:-10,p_reason:'Clear stock before inactive product test'});
  await f.query('owner','update public.products set is_active=false where id=(select product_id from public.product_variants where id=$1)',[v]);
  await denied(()=>f.rpc('cashier','checkout',args),'22023');assert.equal(await qty(v),0);
});
