import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, owner, cashier, secondCashier, inactive, admin, payload, pay } from './database-runtime.mjs';

let db;
before(async () => { db = await startDatabase(); });
after(async () => { await db?.stop(); });
beforeEach(async () => { await db.reset(); });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const stock = async () => (await db.pool.query('select stock_quantity from suwanting_pos.ingredients where id=1')).rows[0].stock_quantity;
const count = async table => (await db.pool.query('select count(*)::int n from suwanting_pos.' + table)).rows[0].n;
const save = (entity, data, user = owner) => db.rpc(user, 'save', { p_entity: entity, p_data: data });
const newProduct = changes => ({ name: 'Americano', sku: '', sku_auto: true, category_id: 1, product_type: 'drink', selling_price: '10000', cost_price: '3000', description: 'Resep uji', is_active: true, variants: [], ...changes });
const imagePath = user => user + '/20000000-0000-4000-8000-000000000001.png';
const storeImage = (user, bucket, path = imagePath(user)) => db.asUser(user, 'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3::jsonb)', [bucket,path,JSON.stringify({ mimetype: 'image/png', size: 100 })]);

test('migration exposes only status to anonymous; active profile needed for bootstrap', async () => {
    assert.equal((await db.rpc(null, 'status')).version, 3);
    await rejects(db.rpc(null, 'bootstrap'), '42501');
    await rejects(db.rpc(inactive, 'bootstrap'), '42501');
    const data = await db.rpc(cashier, 'bootstrap');
    assert.equal(data.profile.role, 'cashier');
    assert.equal(data.products[0].name, 'Kopi Susu Suwanting');
    assert.equal(data.products[0].variants[0].name, 'Iced');
});

test('cash checkout recalculates totals and records actor, invoice, recipe usage', async () => {
    const sale = await pay(db, owner, payload({ discount: '3000', items: [{ product_id: 1, quantity: 2 }] }));
    assert.equal(sale.total, 49950);
    assert.equal(sale.tax_amount, 4950);
    assert.equal(await stock(), '63.750');
    const movement = (await db.pool.query('select * from suwanting_pos.stock_movements')).rows[0];
    assert.equal(movement.reference, sale.invoice_number);
    assert.equal(movement.user_id, owner);
    assert.equal(movement.stock_before, '100.000');
    assert.equal(movement.stock_after, '63.750');
    assert.equal(await count('audit_logs'), 1);
});

test('registered customer and variant snapshot remain after changes; retry is idempotent', async () => {
    const data = payload({ customer_id: 1, customer_name: 'Spoofed', items: [{ product_id: 1, variant_id: 1, quantity: 1 }] });
    const sale = await pay(db, cashier, data);
    assert.equal(sale.total, 28860);
    assert.equal(sale.customer_name, 'Pelanggan Uji');
    assert.equal(await stock(), '79.875');
    await db.rpc(owner, 'archive', { p_entity: 'customers', p_id: 1 });
    assert.equal((await pay(db, cashier, data)).id, sale.id);
    assert.equal(await count('stock_movements'), 1);
    assert.equal((await db.rpc(cashier, 'sale', { p_id: sale.id })).items[0].variant_name, 'Iced');
});

test('tax switch and exact fractional rounding match established checkout behavior', async () => {
    await save('settings', { tax_enabled: false });
    assert.equal((await pay(db, owner)).total, 24000);
    await save('settings', { tax_enabled: true, tax_rate: '10.00' });
    await db.pool.query('update suwanting_pos.products set selling_price=0.05');
    assert.equal((await pay(db, owner)).total, 0.06);
});

test('insufficient combined stock rolls back every checkout write', async () => {
    await rejects(pay(db, cashier, payload({ amount_received: '200000', items: [{ product_id: 1, quantity: 3 }, { product_id: 1, quantity: 3 }] })), '23514');
    assert.equal(await stock(), '100.000');
    for (const table of ['sales', 'sale_items', 'sale_item_ingredients', 'stock_movements', 'audit_logs']) assert.equal(await count(table), 0);
});

test('database error after stock update rolls back sale, balance, audit and movement', async () => {
    await db.pool.query(`create function suwanting_pos.fail_test() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$;
        create trigger fail_test after insert on suwanting_pos.stock_movements for each row execute function suwanting_pos.fail_test();`);
    try {
        await rejects(pay(db, cashier), 'P0001');
        assert.equal(await stock(), '100.000');
        for (const table of ['sales', 'sale_items', 'sale_item_ingredients', 'stock_movements', 'audit_logs']) assert.equal(await count(table), 0);
    } finally { await db.pool.query('drop trigger fail_test on suwanting_pos.stock_movements; drop function suwanting_pos.fail_test()'); }
});

test('different products racing for shared last ingredient allow one checkout', async () => {
    await db.pool.query(`insert into suwanting_pos.products(category_id,name,sku,product_type,selling_price) values(1,'Kopi Kedua','TEST-K2','drink',24000);
        insert into suwanting_pos.recipes(product_id) values(2); insert into suwanting_pos.recipe_items values(3,1,18.125);
        update suwanting_pos.ingredients set stock_quantity=18.125;`);
    const results = await Promise.allSettled([pay(db, cashier), pay(db, secondCashier, payload({ items: [{ product_id: 2, quantity: 1 }] }))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === '23514').length, 1);
    assert.equal(await stock(), '0.000');
    assert.equal(await count('sales'), 1);
});

test('identical concurrent checkouts commit one sale and one deduction', async () => {
    const data = payload();
    const results = await Promise.allSettled([pay(db, cashier, data), pay(db, cashier, data)]);
    for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.message);
    assert.equal(results[0].value.id, results[1].value.id);
    assert.equal(await stock(), '81.875');
    assert.equal(await count('sales'), 1);
    assert.equal(await count('stock_movements'), 1);
});

test('same key cannot be reused by another cashier or changed payload', async () => {
    const data = payload();
    await pay(db, cashier, data);
    await rejects(pay(db, secondCashier, data), '42501');
    await rejects(pay(db, cashier, { ...data, customer_name: 'Different' }), '22023');
});

test('pending confirmation uses original recipe once and enforces cashier scope', async () => {
    const sale = await pay(db, cashier, payload({ payment_method: 'qris' }));
    assert.equal(await stock(), '100.000');
    await db.pool.query('update suwanting_pos.recipe_items set quantity=99');
    await rejects(db.rpc(secondCashier, 'confirm_payment', { p_id: sale.id }), 'P0002');
    const results = await Promise.allSettled([db.rpc(cashier, 'confirm_payment', { p_id: sale.id }), db.rpc(cashier, 'confirm_payment', { p_id: sale.id })]);
    for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.message);
    assert.equal(await stock(), '81.875');
    assert.equal(await count('stock_movements'), 1);
});

test('failed confirmation leaves payment pending and inventory unchanged', async () => {
    const sale = await pay(db, cashier, payload({ payment_method: 'transfer' }));
    await db.pool.query('update suwanting_pos.ingredients set stock_quantity=0');
    await rejects(db.rpc(cashier, 'confirm_payment', { p_id: sale.id }), '23514');
    assert.equal((await db.rpc(cashier, 'sale', { p_id: sale.id })).status, 'pending');
    assert.equal(await count('stock_movements'), 0);
});

test('client cannot set price, stock balance, self role, or spoof discount claim', async () => {
    await rejects(pay(db, cashier, payload({ total: 1 })), '22023');
    await rejects(save('ingredients', { id: 1, name: 'Biji', sku: 'TEST-BIJI', inventory_unit_id: 1, minimum_stock: '0', stock_quantity: '999' }), '22023');
    await rejects(save('profiles', { id: cashier, name: 'Kasir', role: 'owner', is_active: true }, cashier), '42501');
    await rejects(db.asUser(cashier, 'select public.scpos_checkout($1::jsonb)', [JSON.stringify(payload({ discount: '1000' }))], { role: 'owner', user_metadata: { role: 'owner' } }), '42501');
    assert.equal(await stock(), '100.000');
});

test('cashier reads own sales only and cannot access reports, catalog admin or raw tables', async () => {
    const sale = await pay(db, owner);
    assert.equal((await db.rpc(cashier, 'list', { p_entity: 'sales' })).total, 0);
    await rejects(db.rpc(cashier, 'sale', { p_id: sale.id }), 'P0002');
    for (const name of ['options', 'report']) await rejects(db.rpc(cashier, name), '42501');
    for (const entity of ['profiles', 'audit', 'ingredients', 'products']) await rejects(db.rpc(cashier, 'list', { p_entity: entity }), '42501');
    await rejects(db.asUser(owner, 'select * from suwanting_pos.profiles'), '42501');
    await rejects(db.asUser(owner, 'select suwanting_pos.consume(1,$1)', [owner]), '42501');
});

test('customer CRUD preserves audit and lookup excludes archived/inactive records', async () => {
    const row = await save('customers', { name: '<script>alert(1)</script>', phone: '0800', email: 'valid@example.test', notes: 'test', is_active: true }, admin);
    const lookup = await db.rpc(cashier, 'customer_lookup', { p_query: '0800' });
    assert.deepEqual(Object.keys(lookup[0]).sort(), ['id', 'name', 'phone']);
    assert.equal(lookup[0].name, '<script>alert(1)</script>');
    await db.rpc(admin, 'archive', { p_entity: 'customers', p_id: row.id });
    assert.deepEqual(await db.rpc(cashier, 'customer_lookup', { p_query: '0800' }), []);
    assert.equal(await count('audit_logs'), 2);
    await rejects(save('customers', { name: 'Bad', email: 'bad' }), '22023');
});

test('manual stock mutations require reason/reference, prevent negatives, retry once', async () => {
    const data = { ingredient_id: 1, idempotency_key: crypto.randomUUID(), type: 'receipt', quantity: '25.125', reference: 'PO-TEST', reason: 'Penerimaan uji' };
    const movement = await db.rpc(admin, 'stock', { p_data: data });
    assert.equal((await db.rpc(admin, 'stock', { p_data: data })).id, movement.id);
    assert.equal(await stock(), '125.125');
    assert.equal(await count('stock_movements'), 1);
    await rejects(db.rpc(cashier, 'stock', { p_data: data }), '42501');
    await rejects(db.rpc(owner, 'stock', { p_data: { ...data, idempotency_key: crypto.randomUUID(), reference: '' } }), '22023');
    await rejects(db.rpc(owner, 'stock', { p_data: { ...data, idempotency_key: crypto.randomUUID(), type: 'adjustment', direction: 'remove', quantity: '126' } }), '23514');
});

test('product variants and recipes validate ownership, units remain stable, archive is guarded', async () => {
    await rejects(save('units', { id: 1, name: 'Kg', symbol: 'kg' }), '22023');
    await rejects(db.rpc(owner, 'archive', { p_entity: 'ingredients', p_id: 1 }), '23514');
    const unit = await save('units', { name: 'Mililiter', symbol: 'ml' });
    await rejects(save('ingredients', { id: 1, name: 'Biji', sku: 'TEST-BIJI', inventory_unit_id: unit.id, minimum_stock: '0' }), '22023');
    const product = await save('products', { name: 'Baru', sku: 'TEST-NEW', category_id: 1, product_type: 'drink', selling_price: '10000', is_active: true, variants: [{ name: 'Iced', sku: 'TEST-NEW-I', price_adjustment: '2000' }] });
    await rejects(save('recipes', { product_id: product.id, product_variant_id: 1, items: [{ ingredient_id: 1, quantity: '1' }] }), '22023');
    const recipe = await save('recipes', { product_id: product.id, items: [{ ingredient_id: 1, quantity: '1.125' }], is_active: true });
    const list = await db.rpc(owner, 'list', { p_entity: 'recipes', p_filters: { q: 'Baru' } });
    assert.equal(list.rows[0].id, recipe.id);
    assert.equal(list.rows[0].items[0].quantity, 1.125);
});

test('date-filtered sales reports and usage include only paid consumption', async () => {
    await pay(db, cashier);
    await pay(db, cashier, payload({ payment_method: 'qris' }));
    const report = await db.rpc(owner, 'report');
    assert.equal(report.total, 26640);
    assert.equal(report.count, 1);
    const usage = await db.rpc(admin, 'list', { p_entity: 'usage' });
    assert.equal(usage.rows[0].quantity_used, 18.125);
    const empty = await db.rpc(owner, 'report', { p_filters: { from: '2000-01-01', to: '2000-01-02' } });
    assert.equal(empty.total, 0);
    const dashboard = await db.rpc(cashier, 'dashboard');
    assert.equal(dashboard.sales_total, 26640);
    assert.equal(dashboard.weekly.length, 7);
});

test('owner profile/settings permissions cannot be obtained from signup metadata or stale role', async () => {
    await db.pool.query("insert into auth.users(id,email,raw_user_meta_data) values('10000000-0000-4000-8000-000000000099','new@example.test','{\"role\":\"owner\"}')");
    const profile = (await db.pool.query("select * from suwanting_pos.profiles where email='new@example.test'")).rows[0];
    assert.equal(profile.role, 'cashier');
    assert.equal(profile.is_active, false);
    await rejects(save('profiles', { id: owner, name: 'Owner', role: 'cashier', is_active: true }), '22023');
    await save('profiles', { id: admin, name: 'Admin', role: 'admin', is_active: true, can_manage_catalog: false, can_discount: false });
    await rejects(db.rpc(admin, 'options'), '42501');
    await rejects(save('settings', { tax_enabled: 'false' }), '22023');
    await rejects(save('settings', { receipt_paper: '999' }), '22023');
});

test('product cost and description persist atomically; cashier bootstrap excludes cost', async () => {
    const product = await save('products', { id: 1, name: 'Kopi Susu Suwanting', sku: 'TEST-KSS', category_id: 1, product_type: 'drink', selling_price: '24000', cost_price: '9000.29', description: 'Racikan kopi susu', is_active: true, variants: [] });
    assert.equal(product.cost_price, 9000.29); assert.equal(product.description, 'Racikan kopi susu');
    const catalog = await db.rpc(cashier, 'bootstrap'); assert.equal('cost_price' in catalog.products[0], false);
    assert.equal(catalog.products[0].description, 'Racikan kopi susu');
    assert.equal((await db.rpc(owner, 'list', { p_entity: 'products' })).rows[0].cost_price, 9000.29);
    await rejects(save('products', { id: 1, name: 'Changed', sku: 'TEST-KSS', category_id: 1, product_type: 'drink', selling_price: '24000', cost_price: '-1', variants: [] }), '22023');
    assert.equal((await db.rpc(owner, 'list', { p_entity: 'products' })).rows[0].name, 'Kopi Susu Suwanting');
    await rejects(db.asUser(owner, "select suwanting_pos.scpos_save('products','{}')"), '42501');
});


test('automatic SKU saves concurrently without collisions; manual and variant SKUs remain unique', async () => {
    assert.equal(await db.rpc(owner,'suggest_sku',{p_name:'Americano'}),'AME-001');
    const products = await Promise.all([save('products',newProduct()),save('products',newProduct({name:'Americano Lemonade'}),admin)]);
    assert.deepEqual(products.map(p=>p.sku).sort(),['AME-001','AME-002']);
    assert.equal(await db.rpc(owner,'suggest_sku',{p_name:'Americano'}),'AME-003');
    const manual=await save('products',newProduct({name:'Menu Manual',sku:'custom-15',sku_auto:false}));
    assert.equal(manual.sku,'CUSTOM-15');
    await rejects(save('products',newProduct({sku:'custom-15',sku_auto:false})),'23505');
    const withVariants=await save('products',newProduct({name:'Americano Ice',variants:[{name:'Large',sku:'',sku_auto:true,price_adjustment:'2000',is_active:true}]}));
    assert.equal(withVariants.sku,'AME-003');
    const variant=(await db.pool.query('select sku from suwanting_pos.product_variants where product_id=$1',[withVariants.id])).rows[0];
    assert.equal(variant.sku,'AME-004');
    await rejects(save('products',newProduct({sku:'ame-004',sku_auto:false})),'23505');
    await db.rpc(owner,'archive',{p_entity:'products',p_id:products[0].id});
    assert.equal(await db.rpc(owner,'suggest_sku',{p_name:'Americano'}),'AME-005');
    await rejects(db.rpc(cashier,'suggest_sku',{p_name:'Americano'}),'42501');
    await rejects(db.rpc(owner,'suggest_sku',{p_name:'Americano',p_reserved:{}}),'22023');
});

test('account changes target current active user only; profile cannot grant role or alter another avatar', async () => {
    const result=await db.rpc(cashier,'account',{p_data:{name:'Kasir Baru',phone:'081234',avatar_path:null}});
    assert.equal(result.id,cashier); assert.equal(result.role,'cashier'); assert.equal(result.phone,'081234');
    assert.equal((await db.rpc(owner,'bootstrap')).profile.name,'Owner Pengujian');
    await rejects(db.rpc(null,'account',{p_data:{name:'Anon'}}),'42501');
    await rejects(db.rpc(inactive,'account',{p_data:{name:'Inactive'}}),'42501');
    for(const field of ['id','role','email','can_manage_catalog','is_active']) await rejects(db.rpc(cashier,'account',{p_data:{name:'Spoof',avatar_path:null,[field]:owner}}),'22023');
    await rejects(db.rpc(cashier,'account',{p_data:{name:'',avatar_path:null}}),'22023');
    await rejects(db.rpc(cashier,'account',{p_data:{name:'Kasir',avatar_path:imagePath(cashier)}}),'22023');
    await storeImage(cashier,'scpos-avatars');
    const photo=await db.rpc(cashier,'account',{p_data:{name:'Kasir Foto',phone:'',avatar_path:imagePath(cashier)}});
    assert.equal(photo.avatar_path,imagePath(cashier));
    await rejects(db.rpc(owner,'account',{p_data:{name:'Owner',avatar_path:imagePath(cashier)}}),'42501');
    const audit=(await db.pool.query("select user_id,after_data from suwanting_pos.audit_logs where action='account.saved' order by id desc limit 1")).rows[0];
    assert.equal(audit.user_id,cashier); assert.equal(audit.after_data.name,'Kasir Foto');
});

test('image storage RLS isolates avatars, owner-only branding uploads and referenced image deletion', async () => {
    await storeImage(cashier,'scpos-avatars');
    assert.equal((await db.asUser(owner,'select * from storage.objects where bucket_id=$1',['scpos-avatars'])).length,0);
    assert.equal((await db.asUser(cashier,'select * from storage.objects where bucket_id=$1',['scpos-avatars'])).length,1);
    await rejects(storeImage(owner,'scpos-avatars',imagePath(cashier)),'42501');
    await rejects(storeImage(cashier,'scpos-branding'),'42501');
    await rejects(storeImage(inactive,'scpos-avatars'),'42501');
    await rejects(storeImage(owner,'scpos-branding',owner+'/bad.svg'),'42501');
    await db.rpc(cashier,'account',{p_data:{name:'Kasir',avatar_path:imagePath(cashier)}});
    assert.equal((await db.asUser(cashier,'delete from storage.objects where bucket_id=$1 returning id',['scpos-avatars'])).length,0);
    await db.rpc(cashier,'account',{p_data:{name:'Kasir',avatar_path:null}});
    assert.equal((await db.asUser(cashier,'delete from storage.objects where bucket_id=$1 returning id',['scpos-avatars'])).length,1);
});

test('logo changes require active owner and existing image; public status discloses branding only', async () => {
    await storeImage(owner,'scpos-branding');
    await rejects(db.rpc(admin,'branding',{p_logo_path:imagePath(owner)}),'42501');
    await rejects(db.rpc(owner,'branding',{p_logo_path:'https://example.com/logo.svg'}),'22023');
    const before=(await db.rpc(owner,'bootstrap')).settings;
    const updated=await db.rpc(owner,'branding',{p_logo_path:imagePath(owner)});
    assert.equal(updated.logo_path,imagePath(owner)); assert.equal(updated.tax_rate,before.tax_rate);
    const status=await db.rpc(null,'status');
    assert.deepEqual(Object.keys(status.branding).sort(),['logo_path','shop_name']);
    assert.equal(status.branding.logo_path,imagePath(owner));
    assert.equal((await db.asUser(owner,'delete from storage.objects where bucket_id=$1 returning id',['scpos-branding'])).length,0);
    const settings=await save('settings',{...updated,shop_name:'Logo Coffee'}); assert.equal(settings.logo_path,imagePath(owner));
    await rejects(save('settings',{...updated,logo_path:'https://bad.example/logo'}),'22023');
    const cleared=await db.rpc(owner,'branding',{p_logo_path:null}); assert.equal(cleared.logo_path,null);
    assert.equal((await db.asUser(owner,'delete from storage.objects where bucket_id=$1 returning id',['scpos-branding'])).length,1);
});

test('product type CRUD supports custom menu, renames safely and prevents removal while referenced', async () => {
    const type=await db.rpc(owner,'product_type_save',{p_data:{name:'Merchandise',code:'merch',is_active:true}});
    assert.equal(type.id,'merch');
    await rejects(db.rpc(cashier,'product_type_list'),'42501');
    await rejects(db.rpc(cashier,'product_type_save',{p_data:{name:'Forbidden',code:'bad'}}),'42501');
    await rejects(db.rpc(owner,'product_type_save',{p_data:{name:'Another',code:'merch'}}),'23505');
    const product=await save('products',newProduct({product_type:'merch'}));
    const sale=await pay(db,owner,payload({items:[{product_id:product.id,quantity:1}]}));
    assert.equal((await db.rpc(owner,'sale',{p_id:sale.id})).items[0].product_name,'Americano');
    await db.rpc(owner,'product_type_save',{p_data:{id:'merch',code:'souvenir',name:'Souvenir',is_active:true}});
    assert.equal((await db.pool.query('select product_type from suwanting_pos.products where id=$1',[product.id])).rows[0].product_type,'souvenir');
    await rejects(db.rpc(owner,'product_type_save',{p_data:{id:'souvenir',code:'souvenir',name:'Souvenir',is_active:false}}),'23514');
    await rejects(db.rpc(owner,'delete',{p_entity:'product_types',p_id:'souvenir'}),'23514');
    await rejects(db.rpc(owner,'product_type_archive',{p_code:'souvenir'}),'23514');
    await db.rpc(owner,'archive',{p_entity:'products',p_id:product.id});
    await db.rpc(owner,'product_type_archive',{p_code:'souvenir'});
    assert.equal((await db.rpc(owner,'product_type_list',{p_filters:{q:'Souvenir'}})).total,0);
    assert.equal((await db.rpc(owner,'sale',{p_id:sale.id})).total,sale.total);
    const unused=await db.rpc(owner,'product_type_save',{p_data:{name:'Kemasan',code:'pack',is_active:true}});
    await db.rpc(owner,'delete',{p_entity:'product_types',p_id:unused.id});
    assert.equal((await db.pool.query('select * from suwanting_pos.product_types where code=$1',[unused.id])).rowCount,0);
});

test('delete unused category succeeds and audits; referenced category/product/customer/stock cannot lose history', async () => {
    const category=await save('categories',{name:'Kategori Kosong',is_active:true});
    await rejects(db.rpc(cashier,'delete',{p_entity:'categories',p_id:String(category.id)}),'42501');
    await db.rpc(owner,'delete',{p_entity:'categories',p_id:String(category.id)});
    assert.equal((await db.pool.query('select * from suwanting_pos.categories where id=$1',[category.id])).rowCount,0);
    assert.equal((await db.pool.query("select * from suwanting_pos.audit_logs where action='categories.deleted'")).rowCount,1);
    await pay(db,owner,payload({customer_id:1}));
    for(const [entity,id] of [['categories','1'],['products','1'],['customers','1'],['ingredients','1'],['units','1'],['recipes','1']]) await rejects(db.rpc(owner,'delete',{p_entity:entity,p_id:id}),'23514');
    assert.equal(await count('sales'),1); assert.equal(await count('stock_movements'),1);
    const product=await save('products',newProduct());
    await db.rpc(owner,'delete',{p_entity:'products',p_id:String(product.id)});
    const customer=await save('customers',{name:'Tidak Dipakai'});
    await db.rpc(admin,'delete',{p_entity:'customers',p_id:String(customer.id)});
    await rejects(db.rpc(owner,'delete',{p_entity:'sales',p_id:'1'}),'22023');
});
