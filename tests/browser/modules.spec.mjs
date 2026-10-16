import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [org,outlet,user,unit,variant,product,location,supplier,recipe,po] = Array.from({length:10},(_,i)=>id(i+1));
const timestamp='2026-10-16T10:00:00.000Z';
const common={organization_id:org,created_at:timestamp,updated_at:timestamp,archived_at:null};
const bean={...common,id:variant,product_id:product,name:'Green beans',sku:'GREEN',barcode:'987654',price:20000,unit_id:unit,track_inventory:true,is_active:true,acquisition_cost:100,sale_quantity:1,consumption_mode:'stock',sale_recipe_id:null};
const green={...common,id:product,name:'Green coffee',description:'Development',category_id:null,photo_url:null,is_active:true};

async function mockWorkspace(page,{role='owner',empty=false,expired=false}={}) {
  const calls=[]; const failures=[]; const state={products:empty?[]:[green],variants:empty?[]:[bean],customers:empty?[]:[{...common,id:id(19),name:'Ayu',phone:'081234567890',email:'ayu@example.test'}],failStockOnce:false,stockCalls:[],savedProducts:[],delaySave:false,reportError:false,emptyReports:false};
  page.on('pageerror',error=>failures.push(error.message));
  const expiresAt=Math.floor(Date.now()/1000)+(expired?-3600:3600);
  const token=`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:user,role:'authenticated',exp:expiresAt})).toString('base64url')}.browser-test`;
  await page.addInitScript(({token,user,expiresAt,expired})=>localStorage.setItem('suwanting-pos-auth',JSON.stringify({access_token:token,refresh_token:'browser-test',expires_in:expired?0:3600,expires_at:expiresAt,token_type:'bearer',user:{id:user,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-16T00:00:00Z'}})),{token,user,expiresAt,expired});
  await page.route('https://pos-ui.supabase.test/**',async route=>{
    const req=route.request();const url=new URL(req.url());const path=url.pathname.replace('/rest/v1/','');const body=req.postDataJSON();calls.push({path,url,body,method:req.method()});
    const send=(data,status=200,headers={})=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*',...headers},body:JSON.stringify(data)});
    if(req.method()==='OPTIONS')return send({},200);
    if(path==='rpc/search_product_ids'){
      const term=body.p_search?.toLowerCase()??'';const rows=state.products.filter(p=>!term||`${p.name} ${state.variants.filter(v=>v.product_id===p.id).map(v=>v.sku+' '+v.barcode).join(' ')}`.toLowerCase().includes(term));
      return send({count:rows.length,ids:rows.slice((body.p_page-1)*20,body.p_page*20).map(p=>p.id)});
    }
    if(path==='rpc/finance_overview')return send({gross_sales:100000,payments_received:90000,refunds:0,pending_settlement:0,cash_in:90000,cash_out:0,other_income:0,operating_expenses:0,asset_purchases:0,owner_capital:0,loan_proceeds:0,loan_principal_paid:0,loan_interest_paid:0,loan_fees_paid:0,open_shifts:0,unreconciled_shifts:0,account_balances:[{id:id(31),name:'Laci kas',kind:'cash',balance:90000}]});
    if(path==='rpc/analytics_report'){
      if(state.reportError)return send({code:'XX000',message:'Database unavailable'},500);
      if(state.emptyReports)return send({
        sales:{gross_sales:0,discounts:0,refunds:0,refund_tax:0,net_sales:0,sales_tax:0,transactions:0,average_transaction:0,cogs:0,gross_profit:0},
        profit_loss:{net_sales:0,cogs:0,gross_profit:0,other_income:0,operating_expenses:0,interest_expense:0,loan_fees:0,waste_cost:0,cash_shortage:0,net_profit:0},
        cashflow:{cash_in:0,cash_out:0,net_cashflow:0},series:[],products:[],categories:[],outlets:[],payment_methods:[],
        expenses:[],cash_movements:[],account_balances:[],inventory:{quantity:0,valuation:0,items:[]},low_stock:[],
        inventory_movements:[],waste:[],production:[],payment_reconciliation:[],cashiers:[],recent_transactions:[],
      });
      return send({
      sales:{gross_sales:100000,discounts:10000,refunds:0,refund_tax:0,net_sales:90000,sales_tax:0,transactions:2,average_transaction:45000,cogs:30000,gross_profit:60000},
      profit_loss:{net_sales:90000,cogs:30000,gross_profit:60000,other_income:0,operating_expenses:5000,interest_expense:0,loan_fees:0,waste_cost:0,cash_shortage:0,net_profit:55000},
      cashflow:{cash_in:90000,cash_out:5000,net_cashflow:85000},
      series:[{period:'2026-10-16',gross_sales:100000,net_sales:90000,transactions:2}],
      products:[],categories:[],outlets:[],payment_methods:[],expenses:[],cash_movements:[],account_balances:[],
      inventory:{quantity:0,valuation:0,items:[]},low_stock:[],inventory_movements:[],waste:[],production:[],
      payment_reconciliation:[],cashiers:[],recent_transactions:[],
      });
    }
    if(path==='rpc/save_product'){
      state.savedProducts.push(body);if(state.delaySave)await new Promise(resolve=>setTimeout(resolve,350));
      state.products=[{...green,name:body.p_name}];state.variants=body.p_variants.map((v,i)=>({...bean,...v,id:id(100+i)}));return send(product);
    }
    if(path==='rpc/list_stock')return send({count:1,rows:[{id:variant,sku:'GREEN',name:'Green beans',product_name:'Green coffee',unit_code:'g',unit_id:unit,quantity:10,inventory_value:1000,minimum_stock:20,revision:7}]});
    if(path==='rpc/mutate_stock'){
      state.stockCalls.push(body);
      if(state.failStockOnce){state.failStockOnce=false;return send({code:'NETWORK_TEST',message:'Koneksi terputus setelah dikirim'},503);}
      return send(id(200));
    }
    if(path==='customers'&&req.method()==='POST'){
      const customer={...common,id:id(20),...body};
      state.customers.push(customer);
      return send([{id:customer.id}],201,{'content-range':'*/1'});
    }
    if(path==='customers'&&req.method()==='PATCH'){
      const customer=state.customers.find(row=>url.searchParams.get('id')===`eq.${row.id}`);
      if(customer)Object.assign(customer,body);
      return send(customer?[{id:customer.id}]:[],200,{'content-range':customer?'0-0/1':'*/0'});
    }
    if(path==='customers'&&req.method()==='GET'){
      let rows=state.customers.filter(row=>row.organization_id===url.searchParams.get('organization_id')?.slice(3));
      const archivedFilter=url.searchParams.get('archived_at');
      if(archivedFilter==='is.null')rows=rows.filter(row=>row.archived_at===null);
      if(archivedFilter==='not.is.null')rows=rows.filter(row=>row.archived_at!==null);
      const search=url.searchParams.get('name')?.replace(/^ilike\./,'').replace(/^%|%$/g,'').toLowerCase();
      if(search)rows=rows.filter(row=>row.name.toLowerCase().includes(search));
      rows.sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
      const count=rows.length;const offset=Number(url.searchParams.get('offset')||0);const limit=Number(url.searchParams.get('limit')||20);rows=rows.slice(offset,offset+limit);
      return send(rows,200,{'content-range':count?`${offset}-${offset+rows.length-1}/${count}`:'*/0'});
    }
    if(path==='rpc/run_production'||path==='rpc/receive_purchase_order_at'||path==='rpc/save_recipe'||path==='rpc/create_purchase_order'||path==='rpc/approve_purchase_order'||path==='rpc/archive_product'||path==='rpc/set_minimum_stock'||path==='rpc/record_expense_once')return send(id(201));
    const tables={
      organization_members:[{id:id(12),organization_id:org,outlet_id:null,role,is_active:true,organizations:{name:'Suwanting Coffee'}}],
      outlets:[{...common,id:outlet,code:'MAIN',name:'Suwanting outlet'}],
      units:[{...common,id:unit,code:'g',name:'Gram',dimension:'mass',factor_to_base:1}],
      categories:[],products:state.products,product_variants:state.variants,
      storage_locations:[{...common,id:location,outlet_id:outlet,name:'Gudang utama',code:'MAIN',is_default:true}],
      inventory_location_balances:[{id:id(99),organization_id:org,outlet_id:outlet,storage_location_id:location,variant_id:variant,quantity:10,inventory_value:1000,revision:7}],
      suppliers:[{...common,id:supplier,name:'Koperasi petani',phone:null,email:null,address:null}],
      recipes:[{...common,id:recipe,name:'Roast medium',output_variant_id:variant,yield_quantity:8,recipe_kind:'roasting',version:2,output_unit_id:unit}],
      recipe_items:[{...common,id:id(16),recipe_id:recipe,variant_id:variant,unit_id:unit,quantity:10}],
      purchase_orders:[{...common,id:po,outlet_id:outlet,supplier_id:supplier,number:'PO-TEST',status:'approved',created_by:user}],
      purchase_order_items:[{...common,id:id(18),outlet_id:outlet,purchase_order_id:po,variant_id:variant,quantity:5,unit_cost:100,unit_id:unit}],
      customers:state.customers,
      production_batches:[],inventory_movements:[],production_inputs:[],production_outputs:[],
      cash_accounts:[{...common,id:id(31),outlet_id:outlet,name:'Laci kas',kind:'cash'}],
      expense_categories:[{...common,id:id(32),name:'Operasional'}],
      financial_accounts:[{...common,id:id(33),code:'1000',name:'Kas dan bank',kind:'asset'},{...common,id:id(34),code:'5000',name:'Beban operasional',kind:'expense'}],
      expenses:[],cash_movements:[],assets:[],loans:[],loan_payments:[],cashier_shifts:[],cash_reconciliations:[],
      journal_entries:[],journal_lines:[],audit_logs:[],
    };
    if(path in tables){
      let rows=tables[path];
      for(const [column,filter] of url.searchParams){if(filter.startsWith('eq.') && rows[0] && column in rows[0])rows=rows.filter(r=>String(r[column])===filter.slice(3));}
      const count=rows.length;const offset=Number(url.searchParams.get('offset')||0);const limit=Number(url.searchParams.get('limit')||20);rows=rows.slice(offset,offset+limit);
      return send(rows,200,{'content-range':`${offset}-${offset+rows.length-1}/${count}`});
    }
    if(url.pathname.startsWith('/auth/v1/'))return send({});
    throw new Error(`Unmocked request: ${path}`);
  });
  return {calls,failures,state};
}

test('product form validates required fields, saves one atomic payload and shows loading/success',async({page})=>{
  const {state,failures}=await mockWorkspace(page,{empty:true});
  await page.goto('/products');await expect(page.getByRole('heading',{name:'Produk',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Produk baru',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Simpan produk',exact:true}).click();expect(state.savedProducts).toHaveLength(0);
  await dialog.getByLabel('Nama produk',{exact:true}).fill('Arabica 100 g');
  await dialog.getByLabel('SKU',{exact:true}).fill('ARABICA-100');
  await dialog.getByRole('combobox',{name:'satuan',exact:true}).selectOption(unit);
  await dialog.getByLabel('Harga jual per penjualan (Rp)',{exact:true}).fill('35000');
  state.delaySave=true;
  await dialog.getByRole('button',{name:'Simpan produk',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Menyimpan…',exact:true})).toBeDisabled();
  await expect(dialog).not.toBeVisible();await expect(page.getByText('Perubahan tersimpan',{exact:true})).toBeVisible();
  expect(state.savedProducts).toHaveLength(1);expect(state.savedProducts[0].p_variants[0].sku).toBe('ARABICA-100');expect(state.savedProducts[0].p_variants[0].price).toBe(35000);
  expect(failures).toEqual([]);
});

test('stocktake sends revision and keeps idempotency key across failed-response retry',async({page})=>{
  const {state,failures}=await mockWorkspace(page);state.failStockOnce=true;
  await page.goto('/inventory');await page.getByRole('button',{name:'Mutasi stok',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('combobox',{name:'Jenis',exact:true}).selectOption('stocktake');
  await dialog.getByRole('combobox',{name:'varian stok',exact:true}).selectOption(variant);
  await dialog.getByRole('combobox',{name:'lokasi',exact:true}).selectOption(location);
  await dialog.getByRole('combobox',{name:'g, kg, ml, l, pcs',exact:true}).selectOption(unit);
  await dialog.getByLabel('Jumlah hitungan aktual',{exact:true}).fill('8');
  await dialog.getByLabel('Alasan / catatan',{exact:true}).fill('Opname sore');
  await expect(dialog.getByText(/Revisi: 7/)).toBeVisible();
  await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Simpan',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Koneksi terputus');
  expect(state.stockCalls).toHaveLength(1);await dialog.getByRole('button',{name:'Simpan',exact:true}).click();
  await expect(dialog).not.toBeVisible();expect(state.stockCalls).toHaveLength(2);expect(state.stockCalls[0]).toEqual(state.stockCalls[1]);expect(state.stockCalls[0].p_expected_revision).toBe(7);expect(failures).toEqual([]);
});

test('purchase receipt requires confirmation and selected storage location',async({page})=>{
  const {calls,failures}=await mockWorkspace(page);await page.goto('/inventory');await page.getByRole('button',{name:'Pembelian',exact:true}).click();
  await page.getByRole('button',{name:'Terima barang',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Terima seluruh barang',exact:true}).click();expect(calls.filter(c=>c.path==='rpc/receive_purchase_order_at')).toHaveLength(0);
  await dialog.getByRole('combobox',{name:'lokasi penerimaan',exact:true}).selectOption(location);await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Terima seluruh barang',exact:true}).click();
  await expect(dialog).not.toBeVisible();const call=calls.find(c=>c.path==='rpc/receive_purchase_order_at');expect(call.body).toEqual({p_purchase_order_id:po,p_location_id:location});expect(failures).toEqual([]);
});

test('production captures actual ingredient quantities and actual yield in one RPC',async({page})=>{
  const {calls,failures}=await mockWorkspace(page);await page.goto('/inventory');await page.getByRole('button',{name:'Resep & produksi',exact:true}).click();await page.getByRole('button',{name:'Batch produksi',exact:true}).click();await page.getByRole('button',{name:'Produksi / roasting baru',exact:true}).click();
  await page.getByRole('dialog').getByRole('combobox',{name:'resep',exact:true}).selectOption(recipe);const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('heading',{name:'Batch roasting',exact:true})).toBeVisible();
  await dialog.getByRole('combobox',{name:'lokasi produksi',exact:true}).selectOption(location);await dialog.getByLabel('Jumlah dipakai aktual',{exact:true}).fill('12');await dialog.getByLabel('Hasil / yield aktual',{exact:true}).fill('9');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Catat produksi',exact:true}).click();
  await expect(dialog).not.toBeVisible();const call=calls.find(c=>c.path==='rpc/run_production');expect(call.body.p_output_quantity).toBe(9);expect(call.body.p_inputs[0].quantity).toBe(12);expect(failures).toEqual([]);
});

test('cashier sees read-only catalog and cannot open inventory controls; mobile has no page overflow',async({page})=>{
  const {failures}=await mockWorkspace(page,{role:'cashier'});await page.setViewportSize({width:390,height:844});await page.goto('/products');
  await expect(page.getByRole('button',{name:'Lihat varian',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Produk baru',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.goto('/inventory');await expect(page.getByText('Role kasir tidak memiliki akses modul inventori.')).toBeVisible();await expect(page.getByRole('button',{name:'Mutasi stok',exact:true})).toHaveCount(0);expect(failures).toEqual([]);
});

test('customer contact can be added, archived and restored without deleting history',async({page})=>{
  const {calls,failures,state}=await mockWorkspace(page,{empty:true});
  await page.goto('/customers');
  await expect(page.getByRole('heading',{name:'Pelanggan',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Pelanggan baru',exact:true}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByLabel('Nama',{exact:true}).fill('   ');
  await dialog.getByRole('button',{name:'Simpan pelanggan',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Isi nama pelanggan');
  await dialog.getByLabel('Nama',{exact:true}).fill('Maya Putri');
  await dialog.getByLabel('Nomor telepon',{exact:true}).fill('081234567890');
  await dialog.getByLabel('Email',{exact:true}).fill('maya@example.test');
  await dialog.getByRole('button',{name:'Simpan pelanggan',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Maya Putri',{exact:true})).toBeVisible();
  expect(state.customers[0]).toMatchObject({name:'Maya Putri',phone:'081234567890',email:'maya@example.test'});

  await page.getByRole('button',{name:'Arsipkan',exact:true}).click();
  dialog=page.getByRole('dialog');
  await expect(dialog).toContainText('Transaksi dan struk lama tetap tertaut');
  await dialog.getByRole('button',{name:'Ya, lanjutkan',exact:true}).click();
  await expect(page.getByText('Maya Putri',{exact:true})).toHaveCount(0);
  expect(state.customers[0].archived_at).toBeTruthy();
  await page.getByRole('combobox',{name:'Status data',exact:true}).selectOption('archived');
  await expect(page.getByText('Maya Putri',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Pulihkan',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Ya, lanjutkan',exact:true}).click();
  await expect(page.getByText('Maya Putri',{exact:true})).toHaveCount(0);
  expect(state.customers[0].archived_at).toBeNull();
  expect(calls.filter(call=>call.path==='customers'&&call.method==='DELETE')).toHaveLength(0);
  expect(failures).toEqual([]);
});

test('finance staff can view contacts but cannot edit them',async({page})=>{
  const {failures}=await mockWorkspace(page,{role:'finance_staff'});
  await page.goto('/customers');
  await expect(page.getByText('Ayu',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Pelanggan baru',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Lihat',exact:true}).click();
  await expect(page.getByLabel('Nama',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Simpan pelanggan',exact:true})).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('dashboard and reports render authorized analytics and export the filtered report',async({page})=>{
  const {calls,failures}=await mockWorkspace(page);
  await page.goto('/');
  await expect(page.getByText('DATA SUPABASE',{exact:true})).toBeVisible();
  await expect(page.getByText(/90\.000/).first()).toBeVisible();
  const dashboardCall=calls.find(call=>call.path==='rpc/analytics_report');
  expect(dashboardCall?.body).toMatchObject({p_organization_id:org,p_grain:'day'});

  await page.goto('/reports');
  await page.getByLabel('Metode pembayaran',{exact:true}).selectOption('transfer');
  await expect.poll(()=>calls.some(call=>call.path==='rpc/analytics_report'&&call.body.p_payment_method==='transfer')).toBe(true);
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Ekspor CSV sales',exact:true}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe('suwanting-penjualan.csv');
  const csv=await readFile(await download.path(),'utf8');
  expect(csv.charCodeAt(0)).toBe(0xFEFF);
  expect(csv).toContain('"Bagian","Tanggal / periode","Struk","Outlet","Kasir","Status","Omzet kotor IDR","Penjualan bersih IDR","Transaksi / total IDR"');
  expect(csv).toContain('"Periode","2026-10-16","","","","","100000","90000","2"');
  expect(failures).toEqual([]);
});

test('reporting stays responsive across phone/tablet/desktop and product modal fits a phone',async({page})=>{
  const {failures}=await mockWorkspace(page);
  for(const [width,height] of [[390,844],[768,1024],[1440,900]]){
    await page.setViewportSize({width,height});
    await page.goto('/reports');
    await expect(page.getByRole('heading',{name:'Laporan',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`horizontal overflow at ${width}px`).toBe(true);
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto('/products');
  await page.getByRole('button',{name:'Produk baru',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Produk baru'});
  await expect(dialog).toBeVisible();
  const bounds=await dialog.evaluate(element=>{const rect=element.getBoundingClientRect();return {left:rect.left,right:rect.right,width:rect.width,height:rect.height};});
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(390);
  expect(bounds.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(failures).toEqual([]);
});

test('reports show explicit empty and database-error states; expired auth returns to sign-in',async({page})=>{
  const {state,failures}=await mockWorkspace(page,{empty:true});
  state.emptyReports=true;
  await page.goto('/');
  await expect(page.getByText('Belum ada data yang sesuai.').first()).toBeVisible();
  state.reportError=true;
  await page.goto('/reports');
  await expect(page.getByRole('alert')).toContainText('Database unavailable');
  state.reportError=false;
  await page.getByRole('button',{name:'Coba lagi'}).click();
  await expect(page.getByText('Penjualan harian')).toBeVisible();
  expect(failures).toEqual([]);

  await page.addInitScript(()=>{
    const session=JSON.parse(localStorage.getItem('suwanting-pos-auth')||'{}');
    session.expires_at=Math.floor(Date.now()/1000)-3600;
    session.expires_in=0;
    localStorage.setItem('suwanting-pos-auth',JSON.stringify(session));
  });
  await page.goto('/products');
  await expect(page.getByRole('heading',{name:'Masuk ke workspace'})).toBeVisible();
  expect(failures).toEqual([]);
});

test('inventory staff cannot query customer contacts',async({page})=>{
  const {calls,failures}=await mockWorkspace(page,{role:'inventory_staff'});
  await page.goto('/customers');
  await expect(page.getByText('Role inventori tidak memiliki akses ke data pelanggan.')).toBeVisible();
  expect(calls.filter(call=>call.path==='customers')).toHaveLength(0);
  expect(failures).toEqual([]);
});

test('finance dashboard loads Supabase totals and records an expense through the finance RPC',async({page})=>{
  const {calls,failures}=await mockWorkspace(page);
  await page.goto('/finance');
  await expect(page.getByRole('heading',{name:'Keuangan',exact:true})).toBeVisible();
  await expect(page.getByText('Pembayaran diterima',{exact:true})).toBeVisible();
  await expect(page.getByText(/90\.000/).first()).toBeVisible();
  await page.getByRole('button',{name:'Transaksi',exact:true}).click();
  await page.getByRole('button',{name:'Catat pengeluaran',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Kategori',{exact:true}).selectOption(id(32));
  await dialog.getByLabel('Akun pembayaran',{exact:true}).selectOption(id(31));
  await dialog.getByLabel('Jumlah (IDR)',{exact:true}).fill('12500');
  await dialog.getByLabel('Keterangan',{exact:true}).fill('Tagihan listrik');
  await dialog.getByRole('button',{name:'Simpan',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  const mutation=calls.find(call=>call.path==='rpc/record_expense_once');
  expect(mutation?.body).toMatchObject({p_organization_id:org,p_outlet_id:outlet,p_category_id:id(32),p_cash_account_id:id(31),p_amount:12500,p_description:'Tagihan listrik'});
  expect(mutation?.body.p_idempotency_key).toMatch(/[0-9a-f-]{36}/);
  expect(failures).toEqual([]);
});
