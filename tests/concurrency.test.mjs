import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { migratedDatabase, asUser } from './helpers.mjs';
import { fixture } from './fixtures.mjs';

test('native PostgreSQL: competing withdrawals, duplicate requests, receipts, and checkout are atomic', { timeout: 120000 }, async () => {
  const root=resolve('.test-postgres'); await mkdir(root,{recursive:true});
  const directory=await mkdtemp(join(root,'cluster-'));
  assert.ok(resolve(directory).startsWith(root+sep));
  const connections=[]; let server, started=false;
  try {
    const reservation=createServer(); await new Promise((res,rej)=>reservation.listen(0,'127.0.0.1',res).once('error',rej));
    const port=reservation.address().port; await new Promise(res=>reservation.close(res));
    const password=randomUUID();
    // Constructor and initialization can fail before PostgreSQL starts (for
    // example when Windows denies userInfo). Still clean this run's directory.
    server=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:true,createPostgresUser:false,
      postgresFlags:['-h','127.0.0.1'],onLog:message=>{if(process.env.POS_TEST_DEBUG)console.log(message)},onError:message=>console.error(message)});
    await server.initialise(); await server.start(); started=true;
    async function client() { const c=new pg.Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'}); await c.connect(); connections.push(c); return c; }
    const setup=await client(); const db={exec:sql=>setup.query(sql),query:(sql,args)=>setup.query(sql,args)};
    await migratedDatabase({database:db}); const f=await fixture(db);
    const a=await client(), b=await client(); const adapt=c=>({exec:sql=>c.query(sql),query:(sql,args)=>c.query(sql,args)});
    const secondCashier=randomUUID();
    await setup.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)',
      [secondCashier,'second-cashier@example.test','{"role":"owner"}']);
    await f.rpc('owner','set_member',{
      p_organization_id:f.org,p_user_id:secondCashier,p_role:'cashier',p_outlet_id:f.outlet,
    });
    const secondAccount=await f.insert('cash_accounts',{
      organization_id:f.org,outlet_id:f.outlet,name:'Second cashier drawer',kind:'cash',
    });
    const secondShift=(await asUser(adapt(a),secondCashier,
      'select public.open_shift($1,$2,$3,0) as id',[f.org,f.outlet,secondAccount]))[0].id;
    const capitalKey=randomUUID();
    const capitalArgs=[f.org,f.outlet,f.account,12345,'Concurrent owner','Concurrent contribution',capitalKey];
    const capitalSql='select public.record_capital_contribution($1,$2,$3,$4,$5,$6,$7) as id';
    const contributions=await Promise.all([asUser(adapt(a),f.users.finance_staff,capitalSql,capitalArgs),asUser(adapt(b),f.users.finance_staff,capitalSql,capitalArgs)]);
    assert.deepEqual(contributions[0],contributions[1]);
    assert.equal(Number((await setup.query("select count(*) n from public.cash_movements where reason='capital' and reference_id=$1",[contributions[0][0].id])).rows[0].n),1);
    const [loc]=(await setup.query('select id from public.storage_locations where outlet_id=$1 and is_default',[f.outlet])).rows;
    const product=await f.insert('products',{organization_id:f.org,name:'Last unit'});
    const variant=await f.insert('product_variants',{organization_id:f.org,product_id:product,sku:randomUUID(),name:'Last',unit_id:f.unit,price:100});
    const args=[f.org,f.outlet,loc.id,variant,randomUUID()];
    const incoming=`select public.mutate_stock($1,$2,$3,$4,'incoming',1,null,'Opening',$5,100)`;
    await asUser(adapt(a),f.users.inventory_staff,incoming,args);
    const withdraw=`select public.mutate_stock($1,$2,$3,$4,'outgoing',1,null,'Concurrent withdrawal',$5)`;
    const race=await Promise.allSettled([asUser(adapt(a),f.users.inventory_staff,withdraw,[...args.slice(0,4),randomUUID()]),asUser(adapt(b),f.users.inventory_staff,withdraw,[...args.slice(0,4),randomUUID()])]);
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1); assert.equal(race.filter(r=>r.status==='rejected'&&r.reason.code==='23514').length,1);
    assert.equal(Number((await setup.query('select quantity from public.inventory_balances where variant_id=$1',[variant])).rows[0].quantity),0);
    const duplicate=[...args.slice(0,4),randomUUID()];
    const [first,second]=await Promise.all([asUser(adapt(a),f.users.inventory_staff,incoming,duplicate),asUser(adapt(b),f.users.inventory_staff,incoming,duplicate)]);
    assert.deepEqual(first,second);
    const orderArgs=[f.org,f.outlet,f.shift,randomUUID(),JSON.stringify([{variant_id:variant,quantity:1}]),f.account];
    const checkout='select public.checkout($1,$2,$3,$4,$5,$6)';
    const sales=await Promise.allSettled([asUser(adapt(a),f.users.cashier,checkout,orderArgs),asUser(adapt(b),f.users.cashier,checkout,[...orderArgs.slice(0,3),randomUUID(),...orderArgs.slice(4)])]);
    assert.equal(sales.filter(r=>r.status==='fulfilled').length,1); assert.equal(sales.filter(r=>r.status==='rejected'&&r.reason.code==='23514').length,1);
    const po=await f.rpc('owner','create_purchase_order',{p_organization_id:f.org,p_outlet_id:f.outlet,p_supplier_id:f.supplier,p_number:randomUUID(),p_items:JSON.stringify([{variant_id:variant,quantity:2,unit_cost:100}])});
    await f.rpc('owner','approve_purchase_order',{p_purchase_order_id:po});
    const receipts=await Promise.all([asUser(adapt(a),f.users.inventory_staff,'select public.receive_purchase_order_at($1,$2)',[po,loc.id]),asUser(adapt(b),f.users.inventory_staff,'select public.receive_purchase_order_at($1,$2)',[po,loc.id])]);
    assert.deepEqual(receipts[0],receipts[1]);
    const final=(await setup.query(`select b.quantity,(select sum(m.quantity) from public.inventory_movements m where m.variant_id=b.variant_id) ledger,
      (select sum(l.quantity) from public.inventory_location_balances l where l.variant_id=b.variant_id) locations from public.inventory_balances b where variant_id=$1`,[variant])).rows[0];
    assert.equal(Number(final.quantity),2); assert.equal(Number(final.ledger),2); assert.equal(Number(final.locations),2);
    // v2 POS: two held orders may display the same last stock. Only one final
    // cash checkout may commit; the loser must have no payment or journal.
    const hold='select public.hold_order($1,$2,$3,$4,$5) as id';
    const cashiers=[{user:f.users.cashier,shift:f.shift,account:f.account},{user:secondCashier,shift:secondShift,account:secondAccount}];
    const held=await Promise.all(cashiers.map((cashier,index)=>asUser(adapt(index===0?a:b),cashier.user,hold,
      [f.org,f.outlet,cashier.shift,randomUUID(),JSON.stringify([{variant_id:variant,quantity:2}])]).then(rows=>rows[0].id)));
    const finish='select public.finalize_pos_order($1,$2,$3) as id';
    const parts=cashier=>JSON.stringify([{cash_account_id:cashier.account,method:'cash',amount:200,tendered_amount:500}]);
    const keys=[randomUUID(),randomUUID()];
    const finals=await Promise.allSettled(cashiers.map((cashier,index)=>asUser(adapt(index===0?a:b),cashier.user,finish,[held[index],parts(cashier),keys[index]])));
    assert.equal(finals.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(finals.filter(r=>r.status==='rejected'&&r.reason.code==='23514').length,1);
    const winner=finals.findIndex(r=>r.status==='fulfilled'),loser=1-winner;
    assert.equal(Number((await setup.query('select count(*) n from public.payments where order_id=$1',[held[loser]])).rows[0].n),0);
    const replay=await Promise.all([asUser(adapt(a),cashiers[winner].user,finish,[held[winner],parts(cashiers[winner]),keys[winner]]),asUser(adapt(b),cashiers[winner].user,finish,[held[winner],parts(cashiers[winner]),keys[winner]])]);
    assert.deepEqual(replay[0],replay[1]);
    assert.equal(Number((await setup.query('select count(*) n from public.payments where order_id=$1',[held[winner]])).rows[0].n),1);
    assert.equal(Number((await setup.query('select quantity from public.inventory_balances where variant_id=$1',[variant])).rows[0].quantity),0);
    // Pending allocations race: one attempt wins, the second cannot overcollect.
    const pending=held[loser]; const ep=JSON.stringify([{cash_account_id:f.accountBank,method:'qris',amount:200}]);
    const allocations=await Promise.allSettled([asUser(adapt(a),cashiers[loser].user,finish,[pending,ep,randomUUID()]),asUser(adapt(b),cashiers[loser].user,finish,[pending,ep,randomUUID()])]);
    assert.equal(allocations.filter(r=>r.status==='fulfilled').length,1);assert.equal(allocations.filter(r=>r.status==='rejected'&&r.reason.code==='22023').length,1);
    const attempt=(await setup.query('select id from public.pos_payment_attempts where order_id=$1',[pending])).rows[0].id;
    const resolution=[attempt,'paid',randomUUID(),'Verified actual settlement'];
    const settled=await Promise.all([asUser(adapt(a),f.users.finance_staff,'select public.resolve_payment_attempt($1,$2,$3,$4)',resolution),asUser(adapt(b),f.users.finance_staff,'select public.resolve_payment_attempt($1,$2,$3,$4)',resolution)]);
    assert.deepEqual(settled[0],settled[1]);assert.equal(Number((await setup.query('select count(*) n from public.payments where order_id=$1',[pending])).rows[0].n),1);
    const pay=(await setup.query('select id from public.payments where order_id=$1',[pending])).rows[0].id;
    const refunds=await Promise.allSettled([asUser(adapt(a),f.users.finance_staff,'select public.refund_pos_payment($1,200,$2,$3,$4)',[pay,'Full return',randomUUID(),randomUUID()]),asUser(adapt(b),f.users.finance_staff,'select public.refund_pos_payment($1,200,$2,$3,$4)',[pay,'Full return',randomUUID(),randomUUID()])]);
    assert.equal(refunds.filter(r=>r.status==='fulfilled').length,1);assert.equal(refunds.filter(r=>r.status==='rejected'&&r.reason.code==='22023').length,1);
  } finally {
    await Promise.allSettled(connections.map(c=>c.end()));
    if(started) {
      // Graceful PostgreSQL shutdown avoids taskkill's Windows child-process
      // race and releases all data files before the scoped cleanup.
      if(process.platform==='win32') {
        const ctl=resolve('node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe');
        await promisify(execFile)(ctl,['-D',directory,'-m','fast','-w','stop'],{windowsHide:true});
        server.process=undefined;
      } else await server.stop();
    }
    // Only this run's generated workspace directory can be removed.
    assert.ok(resolve(directory).startsWith(root+sep));
    await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
});
