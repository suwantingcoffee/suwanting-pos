import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { migratedDatabase, asUser } from './helpers.mjs';
import { fixture } from './fixtures.mjs';
let db, f, g, kg, ml, l, loc, loc2, locB;
before(async () => {
  db=await migratedDatabase(); f=await fixture(db);
  g=await f.insert('units',{organization_id:f.org,code:'g',name:'Gram'});
  kg=await f.insert('units',{organization_id:f.org,code:'kg',name:'Kilogram'});
  ml=await f.insert('units',{organization_id:f.org,code:'ml',name:'Milliliter'});
  l=await f.insert('units',{organization_id:f.org,code:'l',name:'Liter'});
  [loc]=await f.query('owner','select id from public.storage_locations where outlet_id=$1 and is_default',[f.outlet]); loc=loc.id;
  [loc2]=await f.query('owner','select id from public.storage_locations where outlet_id=$1 and is_default',[f.outlet2]); loc2=loc2.id;
  [locB]=await f.query('ownerB','select id from public.storage_locations where outlet_id=$1 and is_default',[f.outletB]); locB=locB.id;
});
after(async()=>db?.close());
const rejects=(work,code)=>assert.rejects(work,e=>code?e.code===code:!!e.code);
async function variant(name,unit=g) {
  const product=await f.insert('products',{organization_id:f.org,name});
  const id=await f.insert('product_variants',{organization_id:f.org,product_id:product,name,sku:randomUUID(),unit_id:unit,price:25000});
  return {id,product};
}
const stock=(id,quantity,extra={},user='inventory_staff')=>f.rpc(user,'mutate_stock',{
  p_organization_id:f.org,p_outlet_id:f.outlet,p_location_id:loc,p_variant_id:id,p_quantity:quantity,p_unit_id:g,
  p_kind:'incoming',p_note:'Test operation',p_request_key:randomUUID(),p_unit_cost:100,...extra
});
const balance=async(id,location=loc)=>(await f.query('owner','select quantity,inventory_value,revision from public.inventory_location_balances where variant_id=$1 and storage_location_id=$2',[id,location]))[0];
const recipe=(output,inputs,extra={})=>f.rpc('owner','save_recipe',{p_organization_id:f.org,p_recipe_id:null,p_name:'Recipe',p_output_variant_id:output,
  p_yield_quantity:1,p_output_unit_id:f.unit,p_kind:'menu',p_items:JSON.stringify(inputs),...extra});

test('category and atomic product/variant CRUD validate uniqueness, ownership, archive and rollback',async()=>{
  const category=await f.insert('categories',{organization_id:f.org,name:'New category'});
  await f.query('owner','update public.categories set name=$1 where id=$2',['Updated category',category]);
  const args={p_organization_id:f.org,p_product_id:null,p_name:'Espresso',p_category_id:category,p_description:'Coffee',p_photo_url:'https://example.test/coffee.jpg',p_is_active:true,
    p_variants:JSON.stringify([{name:'Small',sku:'ESP-S',barcode:'12345678',unit_id:f.unit,price:18000,acquisition_cost:5000,sale_quantity:1}])};
  const product=await f.rpc('inventory_staff','save_product',args);
  const [v]=await f.query('owner','select * from public.product_variants where product_id=$1',[product]);
  assert.equal(v.archived_at,null); assert.equal(v.price,'18000.00');
  await rejects(()=>f.rpc('ownerB','save_product',{...args,p_product_id:product}),'42501');
  await rejects(()=>f.rpc('cashier','save_product',args),'42501');
  await rejects(()=>f.rpc('owner','save_product',{...args,p_photo_url:'javascript:alert(1)'}),'23514');
  await rejects(()=>f.rpc('owner','save_product',{...args,p_name:'Invalid duplicate',p_variants:JSON.stringify([{...v,id:null}])}),'23505');
  assert.equal((await f.query('owner',"select id from public.products where name='Invalid duplicate'")).length,0);
  await f.rpc('owner','save_product',{...args,p_product_id:product,p_name:'Espresso updated',p_variants:JSON.stringify([{...v,price:20000}])});
  await f.rpc('owner','archive_product',{p_product_id:product});
  assert.ok((await f.query('owner','select archived_at from public.products where id=$1',[product]))[0].archived_at);
  await f.query('owner','update public.categories set archived_at=now() where id=$1',[category]);
});
test('mass/volume conversions, incompatible units, finite values and frozen conversions',async()=>{
  const {id}=await variant('Green');
  await stock(id,1.5,{p_unit_id:kg,p_unit_cost:100000});
  assert.equal(Number((await balance(id)).quantity),1500); assert.equal(Number((await balance(id)).inventory_value),150000);
  await rejects(()=>stock(id,1,{p_unit_id:ml}),'22023');
  await rejects(()=>stock(id,0.00000001,{p_unit_id:g}),'22023');
  await rejects(()=>stock(id,'NaN'),'22023');
  await rejects(()=>f.query('owner','update public.units set factor_to_base=1 where id=$1',[kg]),'23514');
  await rejects(()=>f.query('owner','update public.product_variants set unit_id=$1 where id=$2',[kg,id]),'23514');
  const liquid=await variant('Milk',ml); await stock(liquid.id,2,{p_unit_id:l});
  assert.equal(Number((await balance(liquid.id)).quantity),2000);
});
test('idempotent stock movements, negatives, transfer conservation and scope failures',async()=>{
  const {id}=await variant('Transfer'); const key=randomUUID();
  const op=await stock(id,100,{p_request_key:key}); assert.equal(await stock(id,100,{p_request_key:key}),op);
  await rejects(()=>stock(id,99,{p_request_key:key}),'22023');
  await rejects(()=>stock(id,101,{p_kind:'outgoing'}),'23514');
  await rejects(()=>stock(id,10,{p_kind:'transfer',p_destination_location_id:loc2}),'42501');
  await rejects(()=>stock(id,10,{p_kind:'transfer',p_destination_location_id:locB}),'22023');
  await stock(id,40,{p_kind:'transfer',p_destination_location_id:loc2},'owner');
  assert.equal(Number((await balance(id)).quantity),60); assert.equal(Number((await balance(id,loc2)).quantity),40);
  assert.equal(Number((await balance(id)).inventory_value)+Number((await balance(id,loc2)).inventory_value),10000);
  const moves=await f.query('owner','select quantity from public.inventory_movements where operation_id=$1',[op]); assert.equal(moves.length,1);
  for(const table of ['inventory_location_balances','inventory_operations','storage_locations']) assert.deepEqual(await f.query('ownerB',`select id from public.${table} where organization_id=$1`,[f.org]),[]);
  await rejects(()=>stock(id,1,{},'ownerB'),'42501');
});
test('stocktake uses revision, zero count, zero delta, and low-stock server pagination',async()=>{
  const {id}=await variant('Low-stock'); await stock(id,10);
  await f.rpc('owner','set_minimum_stock',{p_organization_id:f.org,p_outlet_id:f.outlet,p_variant_id:id,p_quantity:5});
  const b=await balance(id); await stock(id,1);
  await rejects(()=>stock(id,2,{p_kind:'stocktake',p_expected_revision:Number(b.revision)}),'40001');
  await stock(id,0,{p_kind:'stocktake',p_expected_revision:Number(b.revision)+1});
  assert.equal(Number((await balance(id)).quantity),0); assert.equal(Number((await balance(id)).inventory_value),0);
  await stock(id,0,{p_kind:'stocktake',p_expected_revision:Number(b.revision)+2});
  const result=await f.rpc('inventory_staff','list_stock',{p_organization_id:f.org,p_outlet_id:f.outlet,p_search:'Low-stock',p_low_only:true,p_page:1,p_page_size:1});
  assert.equal(result.count,1); assert.equal(result.rows[0].id,id);
  assert.deepEqual((await f.rpc('ownerB','list_stock',{p_organization_id:f.org,p_outlet_id:f.outlet})).rows,[]);
});
test('supplier/PO receipt converts units, stores historical costs, retries once and rolls back bad receipts',async()=>{
  const {id}=await variant('Receipt'); await stock(id,1000,{p_unit_cost:100});
  const supplier=await f.insert('suppliers',{organization_id:f.org,name:'Cooperative',phone:'0800',email:'farm@example.test'});
  await f.query('owner','update public.suppliers set address=$1 where id=$2',['Temanggung',supplier]);
  await rejects(()=>f.rpc('inventory_staff','create_purchase_order',{p_organization_id:f.org,p_outlet_id:f.outlet,p_supplier_id:supplier,p_number:randomUUID(),
    p_items:JSON.stringify([{variant_id:id,quantity:1.00001,unit_id:kg,unit_cost:200000}])}),'22023');
  const po=await f.rpc('inventory_staff','create_purchase_order',{p_organization_id:f.org,p_outlet_id:f.outlet,p_supplier_id:supplier,p_number:randomUUID(),
    p_items:JSON.stringify([{variant_id:id,quantity:1,unit_id:kg,unit_cost:200000}])});
  await rejects(()=>f.rpc('owner','receive_purchase_order_at',{p_purchase_order_id:po,p_location_id:loc}),'22023');
  await f.rpc('manager','approve_purchase_order',{p_purchase_order_id:po});
  await rejects(()=>f.rpc('ownerB','receive_purchase_order_at',{p_purchase_order_id:po,p_location_id:loc}),'42501');
  const receipt=await f.rpc('inventory_staff','receive_purchase_order_at',{p_purchase_order_id:po,p_location_id:loc});
  assert.equal(await f.rpc('inventory_staff','receive_purchase_order_at',{p_purchase_order_id:po,p_location_id:loc}),receipt);
  assert.equal(Number((await balance(id)).quantity),2000); assert.equal(Number((await balance(id)).inventory_value),300000);
  await stock(id,100,{p_kind:'outgoing'});
  const [movement]=await f.query('owner',"select unit_cost,total_cost from public.inventory_movements where variant_id=$1 and reason='outgoing'",[id]);
  assert.equal(Number(movement.unit_cost),150); assert.equal(Number(movement.total_cost),-15000);
  await f.query('owner','update public.product_variants set acquisition_cost=999 where id=$1',[id]);
  assert.equal(Number((await f.query('owner','select unit_cost from public.goods_receipt_items where goods_receipt_id=$1',[receipt]))[0].unit_cost),200000);
});
test('roasting uses actual green input/output, carries cost, is idempotent and records waste',async()=>{
  const input=await variant('Green roasting'); const output=await variant('Roasted'); await stock(input.id,2000,{p_unit_cost:100});
  const rec=await recipe(output.id,[{variant_id:input.id,quantity:1,unit_id:kg}],{p_kind:'roasting',p_output_unit_id:kg,p_yield_quantity:0.8});
  const args={p_organization_id:f.org,p_outlet_id:f.outlet,p_location_id:loc,p_recipe_id:rec,p_output_quantity:850,p_output_unit_id:g,
    p_inputs:JSON.stringify([{variant_id:input.id,quantity:1,unit_id:kg}]),p_notes:'Medium',p_request_key:randomUUID()};
  const batch=await f.rpc('inventory_staff','run_production',args); assert.equal(await f.rpc('inventory_staff','run_production',args),batch);
  assert.equal(Number((await balance(input.id)).quantity),1000); assert.equal(Number((await balance(output.id)).quantity),850);
  assert.equal(Number((await balance(output.id)).inventory_value),100000);
  await stock(output.id,50,{p_kind:'waste'}); assert.equal(Number((await balance(output.id)).quantity),800);
  await rejects(()=>f.rpc('inventory_staff','run_production',{...args,p_request_key:randomUUID(),p_inputs:JSON.stringify([{variant_id:input.id,quantity:3,unit_id:kg}])}),'23514');
  assert.equal(Number((await balance(output.id)).quantity),800);
});
test('menu recipe checkout consumes once, snapshots version/cost, recipe edits preserve completed history',async()=>{
  const bean=await variant('Espresso beans'); const menu=await variant('Latte',f.unit); await stock(bean.id,1000,{p_unit_cost:200});
  const ingredients=[{variant_id:bean.id,quantity:18,unit_id:g}]; const rec=await recipe(menu.id,ingredients);
  await f.query('owner',"update public.product_variants set consumption_mode='recipe',track_inventory=false,sale_recipe_id=$1 where id=$2",[rec,menu.id]);
  const args={...f.checkoutArgs,p_items:JSON.stringify([{variant_id:menu.id,quantity:2}]),p_promotion_code:null,p_idempotency_key:randomUUID()};
  const sale=await f.rpc('cashier','checkout',args); assert.equal(await f.rpc('cashier','checkout',args),sale);
  assert.equal(Number((await balance(bean.id)).quantity),964); assert.equal(await balance(menu.id),undefined);
  const [line]=await f.query('owner','select id,cost_total,recipe_snapshot from public.order_items where order_id=$1',[sale]);
  assert.equal(Number(line.cost_total),7200); assert.equal(line.recipe_snapshot.recipe.version,1);
  const consumed=await f.query('owner','select quantity from public.order_item_consumptions where order_item_id=$1',[line.id]); assert.equal(consumed.length,1); assert.equal(Number(consumed[0].quantity),36);
  await recipe(menu.id,[{variant_id:bean.id,quantity:20,unit_id:g}],{p_recipe_id:rec});
  assert.deepEqual((await f.query('owner','select recipe_snapshot from public.order_items where id=$1',[line.id]))[0].recipe_snapshot,line.recipe_snapshot);
  await f.rpc('cashier','checkout',{...args,p_idempotency_key:randomUUID()}); assert.equal(Number((await balance(bean.id)).quantity),924);
  await rejects(()=>f.rpc('inventory_staff','run_production',{p_organization_id:f.org,p_outlet_id:f.outlet,p_location_id:loc,p_recipe_id:rec,p_output_quantity:1,p_output_unit_id:f.unit,p_inputs:JSON.stringify(ingredients),p_notes:'No double stock route',p_request_key:randomUUID()}),'22023');
  assert.deepEqual(await f.query('ownerB','select id from public.order_item_consumptions where organization_id=$1',[f.org]),[]);
});
test('stocked menu sale uses output only, sale quantity honored, direct writes/archives blocked',async()=>{
  const stocked=await variant('Pack'); await stock(stocked.id,500);
  await f.query('owner','update public.product_variants set sale_quantity=100 where id=$1',[stocked.id]);
  await f.rpc('cashier','checkout',{...f.checkoutArgs,p_items:JSON.stringify([{variant_id:stocked.id,quantity:2}]),p_promotion_code:null,p_idempotency_key:randomUUID()});
  assert.equal(Number((await balance(stocked.id)).quantity),300);
  await rejects(()=>f.rpc('owner','archive_product',{p_product_id:stocked.product}),'23514');
  await rejects(()=>f.query('owner','update public.inventory_location_balances set quantity=0'),'42501');
  await rejects(()=>f.query('owner','delete from public.inventory_movements'),'42501');
  await rejects(()=>f.query('owner','update public.recipes set yield_quantity=2'),'42501');
  assert.deepEqual(await f.query('ownerB','update public.storage_locations set archived_at=now() where id=$1 returning id',[loc]),[]);
});

test('server catalog search includes SKU/barcode, exact counts and stable pagination under RLS',async()=>{
  const product=await f.insert('products',{organization_id:f.org,name:'Pagination coffee'});
  await f.insert('product_variants',{organization_id:f.org,product_id:product,name:'Medium',sku:'SEARCH-UNIQUE',barcode:'99007766',unit_id:f.unit,price:100});
  for(const term of ['SEARCH-UNIQUE','99007766']) {
    const page=await f.rpc('cashier','search_product_ids',{p_organization_id:f.org,p_search:term,p_page:1,p_page_size:1});
    assert.equal(page.count,1); assert.deepEqual(page.ids,[product]);
    assert.deepEqual((await f.rpc('cashier','search_product_ids',{p_organization_id:f.org,p_search:term,p_page:2,p_page_size:1})).ids,[]);
    assert.equal((await f.rpc('ownerB','search_product_ids',{p_organization_id:f.org,p_search:term})).count,0);
  }
  await rejects(()=>f.rpc('cashier','search_product_ids',{p_organization_id:f.org,p_page_size:10000}),'22023');
});

test('all tenant FKs have indexes and migration-only policies are removed',async()=>{
  const {rows}=await db.query(`select c.conname from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and n.nspname='public' and t.relname=any(private.pos_tables()) and not exists(
      select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indpred is null and
      array(select x from unnest(i.indkey::smallint[]) with ordinality u(x,n) where n<=cardinality(c.conkey) order by n)=c.conkey)`);
  assert.deepEqual(rows,[]);
  assert.deepEqual((await db.query("select policyname from pg_policies where policyname='inventory_migration'")).rows,[]);
});

test('forward migration preserves populated legacy balances, units, history and unrelated data',async()=>{
  let user, org, outlet, variant;
  const isolated=await migratedDatabase({restrictedMigrator:true,onMigration:async(connection,file)=>{
    if(!file.includes('00600'))return;
    await connection.exec('reset role');
    user=randomUUID();
    await connection.query('insert into auth.users(id,email) values($1,$2)',[user,'legacy@example.test']);
    const run=async(sql,args=[])=>asUser(connection,user,sql,args);
    [{id:org}]=await run("select public.create_organization('Legacy organization') id");
    [{id:outlet}]=await run("insert into public.outlets(organization_id,code,name) values($1,'LEGACY','Legacy outlet') returning id",[org]);
    const [{id:unit}]=await run("insert into public.units(organization_id,code,name) values($1,'kg','Kilogram') returning id",[org]);
    const [{id:product}]=await run("insert into public.products(organization_id,name) values($1,'Legacy beans') returning id",[org]);
    [{id:variant}]=await run("insert into public.product_variants(organization_id,product_id,unit_id,sku,name,price) values($1,$2,$3,'LEGACY','Legacy',100) returning id",[org,product,unit]);
    await run("select public.adjust_inventory($1,$2,$3,12.5,'Legacy stock')",[org,outlet,variant]);
    await connection.exec('set role pos_migrator');
  }});
  try{
    const [row]=await asUser(isolated,user,`select b.quantity,lb.quantity location_quantity,lb.inventory_value,u.factor_to_base,
      (select count(*)::int from public.inventory_movements where variant_id=b.variant_id) movements
      from public.inventory_balances b join public.inventory_location_balances lb on lb.variant_id=b.variant_id
      join public.product_variants v on v.id=b.variant_id join public.units u on u.id=v.unit_id where b.variant_id=$1`,[variant]);
    assert.equal(Number(row.quantity),12.5); assert.equal(Number(row.location_quantity),12.5); assert.equal(Number(row.inventory_value),0);
    assert.equal(Number(row.factor_to_base),1000); assert.equal(row.movements,1);
    assert.equal((await isolated.query('select value from public.unrelated_existing_data')).rows[0].value,'preserve me');
    const {rows:[policy]}=await isolated.query("select count(*)::int n from pg_policies where policyname='inventory_migration'"); assert.equal(policy.n,0);
  } finally {await isolated.close();}
});
