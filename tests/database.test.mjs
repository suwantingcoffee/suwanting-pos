import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { migratedDatabase, asUser } from './helpers.mjs';
import { fixture } from './fixtures.mjs';

let db, f;
before(async () => { db = await migratedDatabase(); f = await fixture(db); });
after(async () => { await db?.close(); });
const denied = (fn) => assert.rejects(fn, error => error.code === '42501');

test('all 48 public tables have forced RLS; all contain created_at and updated_at', async () => {
  const { rows } = await db.query(`select tablename, rowsecurity, c.relforcerowsecurity as forced
    from pg_tables t join pg_class c on c.relname=t.tablename join pg_namespace n on n.oid=c.relnamespace
    where t.schemaname='public' and n.nspname='public' and t.tablename = any(private.pos_tables())`);
  assert.equal(rows.length, 48);
  for (const table of rows) { assert.ok(table.rowsecurity && table.forced, table.tablename); }
  const { rows: missing } = await db.query(`select table_name from information_schema.tables t where table_schema='public' and table_name = any(private.pos_tables())
    and not exists (select 1 from information_schema.columns c where c.table_schema=t.table_schema and c.table_name=t.table_name and c.column_name='updated_at')`);
  assert.deepEqual(missing, []);
});

test('fixtures exercise every tenant table; organization B cannot read any A row', async () => {
  const { rows: tables } = await db.query(`select table_name from information_schema.columns where table_schema='public' and column_name='organization_id' order by table_name`);
  for (const { table_name: t } of tables) {
    const { rows: count } = await db.query(`select count(*)::int n from public.${t} where organization_id=$1`, [f.org]);
    assert.ok(count[0].n > 0, `${t} must have an A fixture, or a zero-row RLS test is meaningless`);
    assert.deepEqual(await f.query('ownerB', `select id from public.${t} where organization_id=$1`, [f.org]), [], t);
  }
  assert.deepEqual(await f.query('ownerB', 'select id from public.organizations where id=$1', [f.org]), []);
  assert.deepEqual(await f.query('owner', 'select id from public.product_variants where id=$1', [f.variantB]), []);
  assert.deepEqual(await f.query('ownerB', 'select id from public.profiles where id=$1', [f.users.owner]), []);
});

test('anonymous, outsider and inactive users cannot read tenant business data', async () => {
  for (const user of ['outsider', 'inactive']) {
    for (const table of ['organizations','products','orders','audit_logs','journal_lines']) {
      assert.deepEqual(await f.query(user, `select id from public.${table}`), [], `${user}/${table}`);
    }
  }
  await denied(() => asUser(db, null, 'select id from public.products'));
  await denied(() => asUser(db, null, "select public.create_organization('Anonymous')"));
});

test('JWT user_metadata cannot create privileges or override organization', async () => {
  const rows = await asUser(db, f.users.outsider, 'select id from public.products', [], { role: 'owner', organization_id: f.org });
  assert.deepEqual(rows, []);
  await denied(() => asUser(db, f.users.cashier, 'select public.adjust_inventory($1,$2,$3,1,\'spoof\')',
    [f.org, f.outlet, f.variant], { role: 'owner', organization_id: f.org }));
  assert.deepEqual(await f.query('outsider', 'select id from public.organization_members'), []);
});

test('all editable tenant tables reject foreign inserts and foreign updates affect zero rows', async () => {
  const tables = ['outlets','units','categories','products','product_variants','suppliers','storage_locations',
    'customers','promotions','cash_accounts','expense_categories','financial_accounts','application_settings'];
  for (const t of tables) {
    const { rows: [source] } = await db.query(`select * from public.${t} where organization_id=$1 limit 1`, [f.org]);
    source.id = randomUUID();
    if (source.code) source.code += '-foreign';
    if (source.sku) source.sku += '-foreign';
    if (t === 'categories' || t === 'expense_categories') source.name += '-foreign';
    const keys = Object.keys(source);
    // A copy retains valid A parent references: failure must be authorization.
    await denied(() => f.query('ownerB', `insert into public.${t}(${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map(k => source[k])));
    const result = await f.query('ownerB', `update public.${t} set updated_at=now() where organization_id=$1 returning id`, [f.org]);
    assert.deepEqual(result, [], t);
  }
});

test('composite FKs prevent cross-organization references even for a valid A owner', async () => {
  await assert.rejects(() => f.insert('products', { organization_id: f.orgB, category_id: f.category, name: 'Bad parent' }, 'ownerB'), e => e.code === '23503');
  await assert.rejects(() => f.insert('product_variants', { organization_id: f.org, product_id: f.product,
    unit_id: f.unitB, sku: 'BAD', name: 'Bad unit', price: 1 }), e => e.code === '23503');
  await assert.rejects(() => f.query('owner', 'update public.products set organization_id=$1 where id=$2', [f.orgB, f.product]), e => ['23514','42501'].includes(e.code));
});

test('outlet-scoped members cannot read or operate on another outlet', async () => {
  assert.deepEqual(await f.query('cashier', 'select id from public.outlets where id=$1', [f.outlet2]), []);
  assert.deepEqual(await f.query('cashier', 'select id from public.cash_accounts where id=$1', [f.account2]), []);
  await denied(() => f.rpc('cashier', 'open_shift', { p_organization_id: f.org, p_outlet_id: f.outlet2, p_cash_account_id: f.account2, p_opening_cash: 0 }));
  await denied(() => f.rpc('inventory_staff', 'adjust_inventory', { p_organization_id: f.org, p_outlet_id: f.outlet2, p_variant_id: f.variant, p_quantity: 1, p_reason: 'Other outlet' }));
});

test('cashier, inventory, finance and admin cannot self-promote; last owner survives', async () => {
  for (const user of ['cashier','inventory_staff','finance_staff','admin']) {
    await denied(() => f.rpc(user, 'set_member', { p_organization_id: f.org, p_user_id: f.users[user], p_role: 'owner' }));
    await denied(() => f.query(user, "update public.organization_members set role='owner' where user_id=$1", [f.users[user]]));
  }
  await denied(() => f.rpc('ownerB', 'set_member', { p_organization_id: f.org, p_user_id: f.users.ownerB, p_role: 'owner' }));
  await assert.rejects(() => f.rpc('owner', 'set_member', { p_organization_id: f.org, p_user_id: f.users.owner, p_role: 'cashier' }), e => e.code === '23514');
});

test('sensitive tables deny direct insert, update and delete, including owner sessions', async () => {
  for (const t of ['audit_logs','journal_entries','journal_lines','inventory_balances','inventory_movements','orders','order_items',
    'payments','refunds','cashier_shifts','cash_movements','expenses','loans','loan_payments','purchase_orders','purchase_order_items',
    'goods_receipts','goods_receipt_items','production_batches','production_inputs','production_outputs','waste_records',
    'inventory_location_balances','inventory_operations','order_item_consumptions','recipes','recipe_items','pos_payment_attempts']) {
    await denied(() => f.query('owner', `insert into public.${t} default values`));
    await denied(() => f.query('owner', `update public.${t} set updated_at=now()`));
    await denied(() => f.query('owner', `delete from public.${t}`));
  }
  await denied(() => f.query('owner', 'select private.move_stock($1,$2,$3,1,\'adjustment\',null,\'bypass\')', [f.org, f.outlet, f.variant]));
  const { rows: [roles] } = await db.query("select pg_has_role('authenticated','pos_writer','member') member");
  assert.equal(roles.member, false);
});

test('role matrices protect financial data and restrict sensitive RPCs', async () => {
  assert.deepEqual(await f.query('cashier', 'select id from public.journal_entries'), []);
  assert.deepEqual(await f.query('inventory_staff', 'select id from public.customers'), []);
  assert.ok((await f.query('finance_staff', 'select id from public.journal_entries')).length > 0);
  assert.ok((await f.query('admin', 'select id from public.audit_logs')).length > 0);
  assert.deepEqual(await f.query('cashier', 'select id from public.audit_logs'), []);
  await denied(() => f.rpc('cashier', 'refund_order', { p_order_id: f.order, p_amount: 1, p_reason: 'Unauthorized', p_idempotency_key: randomUUID() }));
  await denied(() => f.rpc('inventory_staff', 'approve_purchase_order', { p_purchase_order_id: f.po }));
});

test('cross-organization RPCs are denied before changing balances or orders', async () => {
  await denied(() => f.rpc('ownerB', 'checkout', { ...f.checkoutArgs, p_idempotency_key: randomUUID() }));
  await denied(() => f.rpc('ownerB', 'refund_order', { p_order_id: f.order, p_amount: 1, p_reason: 'Cross tenant', p_idempotency_key: randomUUID() }));
  await denied(() => f.rpc('ownerB', 'adjust_inventory', { p_organization_id: f.org, p_outlet_id: f.outlet, p_variant_id: f.variant, p_quantity: 1, p_reason: 'Cross tenant' }));
  await denied(() => f.rpc('ownerB', 'receive_purchase_order', { p_purchase_order_id: f.po }));
  await denied(() => f.rpc('ownerB', 'close_shift', { p_shift_id: f.shift, p_closing_cash: 0 }));
  await denied(() => f.rpc('ownerB', 'pay_loan', { p_loan_id: f.loan, p_outlet_id: f.outlet, p_cash_account_id: f.account, p_principal: 1, p_interest: 0 }));
});

test('checkout uses server prices, applies promotions, and retries without duplicate stock/payment', async () => {
  const id = await f.rpc('cashier', 'checkout', f.checkoutArgs);
  assert.equal(id, f.order);
  const [order] = await f.query('cashier', 'select subtotal,discount,total from public.orders where id=$1', [id]);
  assert.equal(Number(order.subtotal), 50000);
  assert.equal(Number(order.discount), 5000);
  assert.equal(Number(order.total), 45000);
  const { rows: [counts] } = await db.query(`select (select count(*) from public.payments where order_id=$1)::int payments,
    (select count(*) from public.inventory_movements where reference_id=$1)::int movements`, [id]);
  assert.deepEqual(counts, { payments: 1, movements: 1 });
  await assert.rejects(() => f.rpc('cashier', 'checkout', { ...f.checkoutArgs, p_items: JSON.stringify([{ variant_id: f.variant, quantity: 1 }]) }), /Idempotency/);
  await assert.rejects(() => f.rpc('cashier', 'checkout', { ...f.checkoutArgs, p_idempotency_key: randomUUID(),
    p_items: JSON.stringify([{ variant_id: f.variant, quantity: 1, unit_price: 1 }]) }), /only variant_id/);
});

test('insufficient inventory rolls back the whole sale; invalid input is rejected', async () => {
  const { rows: [before] } = await db.query('select count(*)::int n from public.orders');
  for (const quantity of [100000, 0, -1, 0.00001]) {
    await assert.rejects(() => f.rpc('cashier', 'checkout', { ...f.checkoutArgs, p_idempotency_key: randomUUID(),
      p_items: JSON.stringify([{ variant_id: f.variant, quantity }]) }));
  }
  await assert.rejects(() => f.rpc('cashier', 'checkout', { ...f.checkoutArgs, p_idempotency_key: randomUUID(), p_items: '{}' }));
  await assert.rejects(() => f.rpc('cashier', 'checkout', { ...f.checkoutArgs, p_idempotency_key: randomUUID(),
    p_items: JSON.stringify([{ variant_id: f.variant, quantity: 2 }, { variant_id: f.variant, quantity: -1 }]) }), /Invalid item quantity/);
  await assert.rejects(() => f.rpc('cashier', 'checkout', { ...f.checkoutArgs, p_idempotency_key: randomUUID(),
    p_items: JSON.stringify([{ variant_id: f.variantB, quantity: 1 }]) }), /Invalid variant/);
  const { rows: [after] } = await db.query('select count(*)::int n from public.orders');
  assert.equal(before.n, after.n);
});

test('existing unrelated data, access grants and RLS configuration are preserved', async () => {
  assert.deepEqual(await f.query('outsider', 'select * from public.unrelated_existing_data'), [{ id: 1, value: 'preserve me' }]);
  const { rows: [table] } = await db.query("select relrowsecurity from pg_class where oid='public.unrelated_existing_data'::regclass");
  assert.equal(table.relrowsecurity, false);
});

test('refund limits, idempotency, stock receipt retry and production conservation', async () => {
  const args = { p_order_id: f.order, p_amount: 1000, p_reason: 'Retry test', p_idempotency_key: randomUUID() };
  const id = await f.rpc('finance_staff', 'refund_order', args);
  assert.equal(await f.rpc('finance_staff', 'refund_order', args), id);
  await assert.rejects(() => f.rpc('finance_staff', 'refund_order', { ...args, p_reason: null }), /Idempotency conflict/);
  await assert.rejects(() => f.rpc('finance_staff', 'refund_order', { ...args, p_amount: 45000, p_idempotency_key: randomUUID() }), /Invalid refund/);
  const { rows: [stock] } = await db.query('select quantity from public.inventory_balances where variant_id=$1', [f.variant]);
  assert.equal(Number(stock.quantity), 103); // 100 + 10 receipt - 4 production - 1 waste - 2 sale.
  await f.rpc('inventory_staff', 'receive_purchase_order', { p_purchase_order_id: f.po });
  const { rows: [stockAfter] } = await db.query('select quantity from public.inventory_balances where variant_id=$1', [f.variant]);
  assert.equal(stock.quantity, stockAfter.quantity);
});

test('journals balance, reject invalid postings, and immutable ledgers reject trusted-role mutations', async () => {
  const { rows: bad } = await db.query(`select e.id from public.journal_entries e left join public.journal_lines l on l.journal_entry_id=e.id
    group by e.id having count(l.id)<2 or sum(l.debit-l.credit)<>0`);
  assert.deepEqual(bad, []);
  const lines = structuredClone(f.lines); lines[1].credit = 99;
  await assert.rejects(() => f.rpc('finance_staff', 'post_journal', { p_organization_id: f.org, p_outlet_id: f.outlet,
    p_description: 'Bad journal', p_entry_date: '2026-10-16', p_idempotency_key: randomUUID(), p_lines: JSON.stringify(lines) }), /Unbalanced journal/);
  await db.exec('begin; set local role pos_writer');
  try { await assert.rejects(() => db.exec('update public.journal_entries set description=\'tamper\''), e => e.code === '42501'); }
  finally { await db.exec('rollback'); }
  // Verify deferred database constraint independently of post_journal's check.
  await db.exec('begin; set local role pos_writer');
  try {
    await db.query('insert into public.journal_entries(organization_id,description,idempotency_key,posted_by) values ($1,$2,$3,$4)',
      [f.org, 'Missing lines', randomUUID(), f.users.owner]);
    await assert.rejects(() => db.exec('commit'), /Journal must balance/);
  } finally { await db.exec('rollback'); }
});

test('finance operations post balanced, idempotent journals for assets, capital, loans and reconciliation', async () => {
  const assetKey = randomUUID();
  const assetArgs = { p_organization_id: f.org, p_outlet_id: f.outlet, p_cash_account_id: f.account,
    p_name: 'Espresso machine test', p_acquired_on: '2026-10-16', p_amount: 125000, p_useful_life_months: 60, p_idempotency_key: assetKey };
  const assetId = await f.rpc('finance_staff', 'record_asset_purchase', assetArgs);
  assert.equal(await f.rpc('finance_staff', 'record_asset_purchase', assetArgs), assetId);
  const { rows: assetLines } = await db.query(`select a.code,l.debit,l.credit from public.cash_movements m
    join public.journal_entries e on e.idempotency_key=m.id
    join public.journal_lines l on l.journal_entry_id=e.id
    join public.financial_accounts a on a.id=l.financial_account_id
    where m.reference_id=$1 and m.reason='asset_purchase'`, [assetId]);
  assert.deepEqual(assetLines.map(line => [line.code, Number(line.debit), Number(line.credit)]).sort(), [
    ['1000', 0, 125000], ['1500', 125000, 0],
  ]);

  const capitalKey = randomUUID();
  const capitalArgs = { p_organization_id: f.org, p_outlet_id: f.outlet, p_cash_account_id: f.account,
    p_amount: 50000, p_contributor: 'Test owner', p_description: 'Additional capital', p_idempotency_key: capitalKey };
  const capitalId = await f.rpc('finance_staff', 'record_capital_contribution', capitalArgs);
  assert.equal(await f.rpc('finance_staff', 'record_capital_contribution', capitalArgs), capitalId);
  const { rows: capitalLines } = await db.query(`select a.code,l.debit,l.credit from public.cash_movements m
    join public.journal_entries e on e.idempotency_key=m.id
    join public.journal_lines l on l.journal_entry_id=e.id
    join public.financial_accounts a on a.id=l.financial_account_id
    where m.reference_id=$1 and m.reason='capital'`, [capitalId]);
  assert.deepEqual(capitalLines.map(line => [line.code, Number(line.debit), Number(line.credit)]).sort(), [
    ['1000', 50000, 0], ['3000', 0, 50000],
  ]);

  const loanKey = randomUUID();
  const loanArgs = { p_organization_id: f.org, p_outlet_id: f.outlet, p_cash_account_id: f.account,
    p_lender: 'Test lender', p_principal: 200000, p_interest_percent: 6, p_started_on: '2026-10-16',
    p_due_on: '2027-10-16', p_idempotency_key: loanKey };
  const loanId = await f.rpc('finance_staff', 'record_loan', loanArgs);
  assert.equal(await f.rpc('finance_staff', 'record_loan', loanArgs), loanId);
  const paymentKey = randomUUID();
  const paymentArgs = { p_loan_id: loanId, p_outlet_id: f.outlet, p_cash_account_id: f.account,
    p_principal: 50000, p_interest: 5000, p_fee: 1000, p_paid_on: '2026-11-16', p_idempotency_key: paymentKey };
  const paymentId = await f.rpc('finance_staff', 'record_loan_payment', paymentArgs);
  assert.equal(await f.rpc('finance_staff', 'record_loan_payment', paymentArgs), paymentId);
  const { rows: paymentLines } = await db.query(`select a.code,l.debit,l.credit from public.cash_movements m
    join public.journal_entries e on e.idempotency_key=m.id
    join public.journal_lines l on l.journal_entry_id=e.id
    join public.financial_accounts a on a.id=l.financial_account_id
    where m.reference_id=$1 and m.reason='loan_payment'`, [paymentId]);
  assert.deepEqual(paymentLines.map(line => [line.code, Number(line.debit), Number(line.credit)]).sort(), [
    ['1000', 0, 56000], ['2000', 50000, 0], ['6000', 5000, 0], ['6100', 1000, 0],
  ]);

  const shift = await f.rpc('owner', 'open_shift', { p_organization_id: f.org, p_outlet_id: f.outlet2,
    p_cash_account_id: f.account2, p_opening_cash: 10000 });
  await f.rpc('owner', 'close_shift', { p_shift_id: shift, p_closing_cash: 10000 });
  const reconciliationKey = randomUUID();
  const reconciliationArgs = { p_shift_id: shift, p_actual_cash: 9000, p_idempotency_key: reconciliationKey };
  const reconciliationId = await f.rpc('finance_staff', 'reconcile_cashier_shift', reconciliationArgs);
  assert.equal(await f.rpc('finance_staff', 'reconcile_cashier_shift', reconciliationArgs), reconciliationId);
  await assert.rejects(() => f.rpc('finance_staff', 'reconcile_cashier_shift', { ...reconciliationArgs, p_actual_cash: 8000 }),
    /already reconciled/);
  const { rows: [reconciliation] } = await db.query('select expected_cash,actual_cash,variance from public.cash_reconciliations where id=$1', [reconciliationId]);
  assert.deepEqual([Number(reconciliation.expected_cash), Number(reconciliation.actual_cash), Number(reconciliation.variance)], [10000, 9000, -1000]);
  const { rows: adjustment } = await db.query(`select m.id from public.cash_movements m where m.reason='adjustment' and m.reference_id=$1`, [reconciliationId]);
  assert.equal(adjustment.length, 1);
  const overview = await f.rpc('finance_staff', 'finance_overview', { p_organization_id: f.org, p_outlet_id: f.outlet,
    p_from: '2026-01-01', p_until: '2027-01-01' });
  assert.equal(Number(overview.loan_fees_paid), 1000);
  const { rows: unbalanced } = await db.query(`select e.id from public.journal_entries e join public.journal_lines l on l.journal_entry_id=e.id
    group by e.id having sum(l.debit-l.credit)<>0`);
  assert.deepEqual(unbalanced, []);
});

test('journal reversal is audited, idempotent, and restricted to approver roles', async () => {
  const accounts = await f.query('finance_staff', `select id,code from public.financial_accounts where organization_id=$1 and code in ('1000','5000')`, [f.org]);
  const journalId = await f.rpc('finance_staff', 'post_journal', { p_organization_id: f.org, p_outlet_id: f.outlet,
    p_description: 'Reversal approval test', p_entry_date: '2026-10-16', p_idempotency_key: randomUUID(),
    p_lines: JSON.stringify([{ account_id: accounts.find(account => account.code === '5000').id, debit: 250, credit: 0 },
      { account_id: accounts.find(account => account.code === '1000').id, debit: 0, credit: 250 }]) });
  const args = { p_journal_entry_id: journalId, p_reason: 'Approved correction', p_idempotency_key: randomUUID() };
  await denied(() => f.rpc('finance_staff', 'reverse_journal_entry', args));
  const reversalId = await f.rpc('manager', 'reverse_journal_entry', args);
  assert.equal(await f.rpc('manager', 'reverse_journal_entry', args), reversalId);
  await assert.rejects(() => f.rpc('manager', 'reverse_journal_entry', { ...args, p_idempotency_key: randomUUID() }), /already reversed/);
  const { rows: lines } = await db.query('select debit,credit from public.journal_lines where journal_entry_id=$1', [reversalId]);
  assert.deepEqual(lines.map(line => [Number(line.debit), Number(line.credit)]), [[0, 250], [250, 0]]);
});

test('analytics report matches source order, refund, cost and cash ledgers and enforces outlet scope', async () => {
  const reportArgs = { p_organization_id: f.org, p_from: '2026-01-01', p_until: '2027-01-01',
    p_outlet_ids: [f.outlet], p_product_id: f.variant, p_category_id: f.category,
    p_payment_method: 'transfer', p_grain: 'month' };
  const report = await f.rpc('finance_staff', 'analytics_report', reportArgs);
  const { rows: [source] } = await db.query(`select
      coalesce(sum(oi.line_total),0)::numeric gross,
      coalesce(sum(oi.line_total*o.discount/nullif(o.subtotal,0)),0)::numeric discount,
      coalesce(sum(oi.cost_total),0)::numeric cogs,
      count(distinct o.id)::integer transactions,
      coalesce(sum(o.tax),0)::numeric tax
    from public.orders o join public.order_items oi on oi.order_id=o.id
    join public.payments pm on pm.order_id=o.id
    join public.product_variants pv on pv.id=oi.variant_id
    join public.products p on p.id=pv.product_id
    where o.organization_id=$1 and o.outlet_id=$2 and o.status='completed'
      and o.finalized_at>=$3::date and o.finalized_at<$4::date
      and oi.variant_id=$5 and p.category_id=$6 and pm.method=$7`,
    [f.org,f.outlet,reportArgs.p_from,reportArgs.p_until,f.variant,f.category,'transfer']);
  const refunds = await db.query(`select coalesce(sum(r.amount-r.tax_amount),0)::numeric amount,
      coalesce(sum(r.amount),0)::numeric gross,coalesce(sum(r.tax_amount),0)::numeric tax
    from public.refunds r join public.payments pm on pm.id=r.payment_id
    join public.orders o on o.id=r.order_id
    where r.organization_id=$1 and r.outlet_id=$2 and r.created_at>=$3::date and r.created_at<$4::date
      and pm.method=$5 and o.status='completed' and exists(select 1 from public.order_items oi
        join public.product_variants pv on pv.id=oi.variant_id join public.products p on p.id=pv.product_id
        where oi.order_id=o.id and oi.variant_id=$6 and p.category_id=$7)`,
    [f.org,f.outlet,reportArgs.p_from,reportArgs.p_until,'transfer',f.variant,f.category]);
  const refund = refunds.rows[0];
  const expectedNet = Number(source.gross)-Number(source.discount)-Number(refund.amount);
  assert.equal(report.sales.gross_sales,Number(source.gross));
  assert.equal(report.sales.discounts,Number(source.discount));
  assert.equal(report.sales.net_sales,expectedNet);
  assert.equal(report.sales.cogs,Number(source.cogs));
  assert.equal(report.sales.transactions,source.transactions);
  assert.equal(report.sales.average_transaction,source.transactions?expectedNet/source.transactions:0);
  assert.equal(report.sales.sales_tax,Number(source.tax));
  assert.equal(report.sales.refunds,Number(refund.gross));
  assert.equal(report.sales.refund_tax,Number(refund.tax));
  assert.equal(report.sales.gross_profit,expectedNet-Number(source.cogs));
  assert.equal(report.series.length,12);
  assert.ok(report.products.every(item=>item.sku==='RAW'));
  await assert.rejects(() => f.rpc('manager','analytics_report',{...reportArgs,p_outlet_ids:[f.outlet2]}),e=>e.code==='42501');
  await assert.rejects(() => f.rpc('cashier','analytics_report',reportArgs),e=>e.code==='42501');
});

test('integrated product-to-sale-to-reconciliation flow preserves stock, journal, report and cash', async () => {
  const productId = await f.rpc('owner', 'save_product', {
    p_organization_id: f.org, p_product_id: null, p_name: `Integrated sale ${randomUUID()}`,
    p_category_id: f.category, p_description: null, p_photo_url: null, p_is_active: true,
    p_variants: JSON.stringify([{ name: 'Regular', sku: `INT-${randomUUID()}`, unit_id: f.unit,
      price: 25000, acquisition_cost: 10000, sale_quantity: 1, is_active: true, consumption_mode: 'stock' }]),
  });
  const [variant] = await f.query('owner', 'select id from public.product_variants where product_id=$1', [productId]);
  const cashAccount = await f.insert('cash_accounts', {
    organization_id: f.org, outlet_id: f.outlet, name: `Integrated drawer ${randomUUID()}`, kind: 'cash',
  });
  await f.rpc('owner', 'adjust_inventory', {
    p_organization_id: f.org, p_outlet_id: f.outlet, p_variant_id: variant.id,
    p_quantity: 3, p_reason: 'Integrated opening stock',
  });
  const shiftId = await f.rpc('owner', 'open_shift', {
    p_organization_id: f.org, p_outlet_id: f.outlet, p_cash_account_id: cashAccount, p_opening_cash: 1000,
  });
  const orderId = await f.rpc('owner', 'hold_order', {
    p_organization_id: f.org, p_outlet_id: f.outlet, p_shift_id: shiftId,
    p_idempotency_key: randomUUID(), p_items: JSON.stringify([{ variant_id: variant.id, quantity: 1 }]),
  });
  const finalizationKey = randomUUID();
  await f.rpc('owner', 'finalize_pos_order', {
    p_order_id: orderId, p_idempotency_key: finalizationKey,
    p_payments: JSON.stringify([{ cash_account_id: cashAccount, method: 'cash', amount: 25000, tendered_amount: 30000 }]),
  });

  const [order] = await f.query('owner', 'select status,payment_status,total from public.orders where id=$1', [orderId]);
  assert.deepEqual([order.status, order.payment_status, Number(order.total)], ['completed', 'paid', 25000]);
  const [balance] = await f.query('owner', 'select quantity from public.inventory_balances where outlet_id=$1 and variant_id=$2', [f.outlet, variant.id]);
  assert.equal(Number(balance.quantity), 2);
  const [payment] = await f.query('owner', 'select id,attempt_id,change_amount from public.payments where order_id=$1', [orderId]);
  assert.equal(Number(payment.change_amount), 5000);
  const [journal] = await f.query('owner', `select count(*)::int count,coalesce(sum(l.debit-l.credit),0)::numeric imbalance
    from public.journal_entries e join public.journal_lines l on l.journal_entry_id=e.id
    where e.idempotency_key=$1 group by e.id`, [payment.attempt_id]);
  assert.equal(journal.count, 2);
  assert.equal(Number(journal.imbalance), 0);

  const report = await f.rpc('finance_staff', 'analytics_report', {
    p_organization_id: f.org, p_from: '2026-01-01', p_until: '2027-01-01',
    p_outlet_ids: [f.outlet], p_product_id: variant.id, p_grain: 'month',
  });
  assert.equal(report.sales.gross_sales, 25000);
  assert.equal(report.sales.net_sales, 25000);
  assert.equal(report.sales.transactions, 1);
  assert.equal(report.products[0].variant_id, variant.id);
  assert.equal(report.sales.cogs, 10000);

  await f.rpc('owner', 'close_shift', { p_shift_id: shiftId, p_closing_cash: 26000 });
  const reconciliationId = await f.rpc('finance_staff', 'reconcile_cashier_shift', {
    p_shift_id: shiftId, p_actual_cash: 26000, p_idempotency_key: randomUUID(),
  });
  const [reconciliation] = await f.query('finance_staff',
    'select expected_cash,actual_cash,variance from public.cash_reconciliations where id=$1', [reconciliationId]);
  assert.deepEqual([Number(reconciliation.expected_cash), Number(reconciliation.actual_cash), Number(reconciliation.variance)], [26000, 26000, 0]);
});

test('audit actor derives from the verified request subject and membership revocation takes effect immediately', async () => {
  const { rows } = await db.query("select actor_id from public.audit_logs where table_name='orders' and record_id=$1 and action='INSERT'", [f.order]);
  assert.equal(rows[0].actor_id, f.users.cashier);
  await f.rpc('owner', 'set_member', { p_organization_id: f.org, p_user_id: f.users.inventory_staff, p_role: 'inventory_staff', p_outlet_id: f.outlet, p_is_active: false });
  await denied(() => f.rpc('inventory_staff', 'adjust_inventory', { p_organization_id: f.org, p_outlet_id: f.outlet, p_variant_id: f.variant, p_quantity: 1, p_reason: 'Revoked' }));
  assert.deepEqual(await f.query('inventory_staff', 'select id from public.inventory_balances'), []);
});

test('function owners cannot bypass RLS, log in, create schema objects or grant roles', async () => {
  const { rows } = await db.query("select rolname,rolsuper,rolbypassrls,rolcanlogin,rolcreaterole from pg_roles where rolname in ('pos_identity','pos_writer','pos_auditor')");
  assert.equal(rows.length, 3);
  for (const r of rows) assert.ok(!r.rolsuper && !r.rolbypassrls && !r.rolcanlogin && !r.rolcreaterole, r.rolname);
  const { rows: schemaGrants } = await db.query(`select rolname from pg_roles
    where rolname in ('pos_identity','pos_writer','pos_auditor')
      and has_schema_privilege(rolname,'auth','USAGE') order by rolname`);
  assert.deepEqual(schemaGrants.map(r => r.rolname), ['pos_auditor','pos_identity','pos_writer']);
  const { rows: uidGrants } = await db.query(`select rolname from pg_roles
    where rolname in ('pos_identity','pos_writer','pos_auditor')
      and has_function_privilege(rolname,'auth.uid()','EXECUTE') order by rolname`);
  assert.deepEqual(uidGrants.map(r => r.rolname), ['pos_auditor','pos_identity','pos_writer']);
  const { rows: funcs } = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prosecdef and not ('search_path=""'=any(p.proconfig))`);
  assert.deepEqual(funcs, []);
});

test('NaN, whitespace-only master names and changed immutable identity are rejected', async () => {
  await assert.rejects(() => f.rpc('owner', 'adjust_inventory', { p_organization_id: f.org, p_outlet_id: f.outlet,
    p_variant_id: f.variant, p_quantity: 'NaN', p_reason: 'Invalid numeric' }), e => ['23514','22023'].includes(e.code));
  await assert.rejects(() => f.insert('categories', { organization_id: f.org, name: '   ' }), e => e.code === '23514');
  await assert.rejects(() => f.query('owner', 'update public.products set id=$1 where id=$2', [randomUUID(), f.product]), e => e.code === '23514');
});

test('development seed requires explicit opt-in, remains additive and can be repeated', async () => {
  const sql = await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8');
  await assert.rejects(() => db.exec(sql), /development opt-in/);
  await db.exec('begin');
  try {
    await db.query("select set_config('app.environment','development',true), set_config('app.seed_organization_id',$1,true)", [f.orgB]);
    await db.exec(sql);
    await db.exec(sql);
    const { rows: [count] } = await db.query("select count(*)::int n from public.outlets where organization_id=$1 and code='DEV'", [f.orgB]);
    assert.equal(count.n, 1);
    await db.exec('commit');
  } catch (e) { await db.exec('rollback'); throw e; }
});

test('archived outlets retain history visibility while rejecting new operations', async () => {
  const { rows: [before] } = await db.query('select count(*)::int n from public.orders where organization_id=$1', [f.org]);
  await f.query('owner', 'update public.outlets set archived_at=now() where id=$1', [f.outlet]);
  assert.equal((await f.query('cashier', 'select id from public.orders')).length, before.n);
  await denied(() => f.rpc('owner', 'adjust_inventory', { p_organization_id: f.org, p_outlet_id: f.outlet,
    p_variant_id: f.variant, p_quantity: 1, p_reason: 'Archived outlet' }));
});

test('customer access follows its role matrix and archiving preserves transaction links', async () => {
  const [customer] = await f.query('cashier',
    'insert into public.customers(organization_id,name,phone,email) values ($1,$2,$3,$4) returning id',
    [f.org, 'Kasir test', '081234567890', 'kasir@example.test']);
  assert.equal((await f.query('finance_staff', 'select id from public.customers where id=$1', [customer.id])).length, 1);
  await denied(() => f.query('inventory_staff',
    'insert into public.customers(organization_id,name) values ($1,$2)', [f.org, 'Tidak diizinkan']));
  await denied(() => f.query('owner', 'delete from public.customers where id=$1', [customer.id]));

  const [before] = await f.query('cashier',
    'select count(*)::int as count from public.orders where customer_id=$1', [f.customer]);
  await f.query('cashier', 'update public.customers set archived_at=now() where id=$1', [f.customer]);
  assert.deepEqual(await f.query('cashier',
    'select id from public.customers where id=$1 and archived_at is null', [f.customer]), []);
  assert.equal((await f.query('cashier',
    'select id from public.customers where id=$1 and archived_at is not null', [f.customer])).length, 1);
  const [after] = await f.query('cashier',
    'select count(*)::int as count from public.orders where customer_id=$1', [f.customer]);
  assert.equal(after.count, before.count);
});

test('migrations and runtime RPCs work under a non-superuser CREATEROLE installer', async () => {
  const isolated = await migratedDatabase({ restrictedMigrator: true, onMigration: async (connection, file) => {
    if (!file.startsWith('20261016000100_') && !file.startsWith('20261016000200_')) return;
    const { rows } = await connection.query(`select c.relname, c.relrowsecurity, c.relforcerowsecurity,
      has_table_privilege('anon',c.oid,'SELECT') as anonymous_read,
      has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_read
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any(private.pos_tables())`);
    assert.equal(rows.length, file.includes('00100') ? 4 : 40);
    for (const r of rows) {
      assert.ok(r.relrowsecurity && r.relforcerowsecurity, r.relname);
      assert.ok(!r.anonymous_read && !r.authenticated_read, r.relname);
    }
  } });
  try {
    const data = await fixture(isolated);
    assert.ok(data.order);
    const { rows: [membership] } = await isolated.query(`select pg_has_role('pos_migrator','pos_writer','usage') writer,
      pg_has_role('pos_migrator','pos_writer','set') can_set_writer,
      pg_has_role('authenticated','pos_writer','member') browser`);
    assert.equal(membership.writer, false);
    assert.equal(membership.can_set_writer, false);
    assert.equal(membership.browser, false);
  } finally { await isolated.close(); }
});

test('forward Auth privilege repair restores audited bootstrap without data loss or broader tenant access', async () => {
  const isolated = await migratedDatabase({ restrictedMigrator: true, throughMigration: '20261017000200_auth_uid_permissions.sql' });
  try {
    const repair = await readFile(new URL('../supabase/migrations/20261017000200_auth_uid_permissions.sql', import.meta.url), 'utf8');
    const usageOnly = await readFile(new URL('../supabase/migrations/20261017000100_auth_schema_usage.sql', import.meta.url), 'utf8');
    const deployment = await readFile(new URL('../docs/DEPLOYMENT.md', import.meta.url), 'utf8');
    const bootstrapMatch = deployment.match(/```sql\r?\n(DO \$\$[\s\S]*?)\r?\n```/);
    assert.ok(bootstrapMatch, 'Exercise the actual SQL Editor bootstrap from the setup guide');
    const bootstrap = bootstrapMatch[1].replace('OWNER_EMAIL', 'bootstrap@example.test');
    const ownerId = randomUUID(), otherOwnerId = randomUUID();
    await isolated.query('insert into auth.users(id,email) values ($1,$2),($3,$4)',
      [ownerId, 'bootstrap@example.test', otherOwnerId, 'existing@example.test']);
    const [{ id: existingOrg }] = await asUser(isolated, otherOwnerId,
      "select public.create_organization('Existing business') as id");
    const snapshotSql = `select (select count(*)::int from public.organizations) organizations,
      (select count(*)::int from public.organization_members) memberships,
      (select count(*)::int from public.financial_accounts) accounts,
      (select count(*)::int from public.audit_logs) audit`;
    const before = (await isolated.query(snapshotSql)).rows;

    // Reproduce the hosted failure even though normal baseline grants are correct.
    // PUBLIC's default EXECUTE must also be removed to detect missing explicit grants.
    await isolated.exec(`set role pos_migrator;
      revoke usage on schema auth from pos_identity,pos_writer,pos_auditor;
      revoke execute on function auth.uid() from pos_identity,pos_writer,pos_auditor;
      reset role;
      revoke execute on function auth.uid() from public`);
    const { rows: brokenGrants } = await isolated.query(`select rolname,
      has_schema_privilege(rolname,'auth','USAGE') as usage,
      has_function_privilege(rolname,'auth.uid()','EXECUTE') as execute
      from pg_roles where rolname in ('pos_identity','pos_writer','pos_auditor')`);
    for (const row of brokenGrants) assert.ok(!row.usage && !row.execute, row.rolname);
    // SQL Editor bootstrap requires a trusted database administrator. The
    // NO BYPASSRLS migrator can grant privileges but cannot directly insert tenants.
    await assert.rejects(() => isolated.exec(bootstrap),
      e => e.code === '42501' && /permission denied for schema auth/.test(e.message));
    assert.deepEqual((await isolated.query(snapshotSql)).rows, before, 'Failed audit rolls back the entire bootstrap');

    // The previous USAGE-only repair still fails when function EXECUTE is missing.
    await isolated.exec('set role pos_migrator');
    await isolated.exec(usageOnly);
    await isolated.exec('reset role');
    await assert.rejects(() => isolated.exec(bootstrap),
      e => e.code === '42501' && /permission denied for function uid/.test(e.message));
    assert.deepEqual((await isolated.query(snapshotSql)).rows, before);

    // Run as the same non-superuser installer, then repeat to model a manual SQL
    // repair followed by CLI migration. Both executions must be additive.
    await isolated.exec('set role pos_migrator');
    await isolated.exec(repair);
    await isolated.exec(repair);
    await isolated.exec('reset role');
    assert.deepEqual((await isolated.query(snapshotSql)).rows, before);
    const { rows: grants } = await isolated.query(`select rolname,
      has_schema_privilege(rolname,'auth','USAGE') as usage,
      has_function_privilege(rolname,'auth.uid()','EXECUTE') as execute,
      has_schema_privilege(rolname,'auth','CREATE') as create_schema,
      has_table_privilege(rolname,'auth.users','SELECT') as read_users
      from pg_roles where rolname in ('pos_identity','pos_writer','pos_auditor')`);
    assert.equal(grants.length, 3);
    for (const row of grants) {
      assert.ok(row.usage && row.execute, row.rolname);
      assert.ok(!row.create_schema && !row.read_users, row.rolname);
    }

    await isolated.exec(bootstrap);
    await assert.rejects(() => isolated.exec(bootstrap), /Owner user already has an active organization membership/);
    const [{ organization_id: org }] = await asUser(isolated, ownerId,
      "select organization_id from public.organization_members where role='owner' and is_active");
    const [{ id: category }] = await asUser(isolated, ownerId,
      "insert into public.categories(organization_id,name) values ($1,'After repair') returning id", [org]);
    const [{ actor_id: actor }] = await asUser(isolated, ownerId,
      "select actor_id from public.audit_logs where table_name='categories' and record_id=$1", [category]);
    assert.equal(actor, ownerId, 'Audit keeps the actual authenticated actor');
    const [{ actor_id: bootstrapActor }] = (await isolated.query(
      "select actor_id from public.audit_logs where table_name='organizations' and record_id=$1", [org])).rows;
    assert.equal(bootstrapActor, null, 'SQL Editor bootstrap has no end-user JWT');
    assert.deepEqual(await asUser(isolated, ownerId, 'select id from public.organizations where id=$1', [existingOrg]), []);
    assert.deepEqual(await asUser(isolated, otherOwnerId, 'select id from public.audit_logs where organization_id=$1', [org]), []);
    await denied(() => asUser(isolated, ownerId,
      "insert into public.categories(organization_id,name) values ($1,'Cross-tenant write')", [existingOrg]));
  } finally { await isolated.close(); }
});

test('hosted installer without Auth grant option runs the complete schema and all fixture RPCs', async () => {
  const isolated = await migratedDatabase({ restrictedMigrator: true, authGrantAuthority: false });
  try {
    const { rows: [installer] } = await isolated.query(`select
      has_schema_privilege('pos_migrator','auth','USAGE') as usage,
      has_schema_privilege('pos_migrator','auth','USAGE WITH GRANT OPTION') as can_grant`);
    assert.ok(installer.usage && !installer.can_grant);
    const data = await fixture(isolated);
    const { rows: roles } = await isolated.query(`select rolname,
      has_schema_privilege(rolname,'auth','USAGE') as usage,
      has_function_privilege(rolname,'private.request_user_id()','EXECUTE') as uid,
      pg_has_role('pos_migrator',rolname,'USAGE') as installer_inherits,
      pg_has_role('authenticated',rolname,'MEMBER') as browser_member
      from pg_roles where rolname in ('pos_identity','pos_writer','pos_auditor')`);
    for (const role of roles) {
      assert.ok(!role.usage && role.uid, role.rolname);
      assert.ok(!role.installer_inherits && !role.browser_member, role.rolname);
    }
    assert.equal((await data.query('cashier', 'select actor_id from public.audit_logs where record_id=$1', [data.order])).length, 0);
    const { rows: [audit] } = await isolated.query("select actor_id from public.audit_logs where table_name='orders' and record_id=$1 and action='INSERT'", [data.order]);
    assert.equal(audit.actor_id, data.users.cashier);
    assert.deepEqual(await data.query('ownerB', 'select id from public.orders where organization_id=$1', [data.org]), []);
    assert.deepEqual(await data.query('ownerB',
      'update public.categories set name=$1 where organization_id=$2 returning id', ['Wrong tenant', data.org]), []);
    await denied(() => data.rpc('cashier', 'set_member', { p_organization_id: data.org, p_user_id: data.users.cashier, p_role: 'owner' }));
    await denied(() => data.rpc('ownerB', 'adjust_inventory', { p_organization_id: data.org, p_outlet_id: data.outlet, p_variant_id: data.variant, p_quantity: 1, p_reason: 'Foreign organization' }));

    // Exercise the user's failing SQL Editor bootstrap with no JWT and no Auth
    // schema grants on any internal role, after the complete migration chain.
    const deployment = await readFile(new URL('../docs/DEPLOYMENT.md', import.meta.url), 'utf8');
    const bootstrapMatch = deployment.match(/```sql\r?\n(DO \$\$[\s\S]*?)\r?\n```/);
    assert.ok(bootstrapMatch);
    const ownerId = randomUUID();
    await isolated.query('insert into auth.users(id,email) values ($1,$2)', [ownerId, 'hosted-bootstrap@example.test']);
    const bootstrap = bootstrapMatch[1].replace('OWNER_EMAIL', 'hosted-bootstrap@example.test');
    await isolated.exec(bootstrap);
    await assert.rejects(() => isolated.exec(bootstrap), /Owner user already has an active organization membership/);
    const [member] = await asUser(isolated, ownerId,
      "select organization_id from public.organization_members where user_id=$1 and role='owner' and is_active", [ownerId]);
    assert.ok(member);
    const { rows: [bootstrapAudit] } = await isolated.query(
      "select actor_id from public.audit_logs where table_name='organizations' and record_id=$1", [member.organization_id]);
    assert.equal(bootstrapAudit.actor_id, null, 'SQL Editor has no end-user JWT; never invent an audit actor');
    assert.deepEqual(await data.query('ownerB', 'select id from public.organizations where id=$1', [member.organization_id]), []);
  } finally { await isolated.close(); }
});

test('request identity forward repair preserves populated data, function grants, RLS and audit actors', async () => {
  const isolated = await migratedDatabase({ restrictedMigrator: true, throughMigration: '20261017000200_auth_uid_permissions.sql' });
  try {
    const data = await fixture(isolated);
    const repair = await readFile(new URL('../supabase/migrations/20261017000300_request_identity.sql', import.meta.url), 'utf8');
    await isolated.exec(`set role pos_migrator;
      create function public.unrelated_auth_reader() returns uuid language sql stable as $$select auth.uid()$$;
      revoke usage on schema auth from pos_identity,pos_writer,pos_auditor;
      reset role;
      revoke grant option for usage on schema auth from pos_migrator;
      revoke grant option for execute on function auth.uid() from pos_migrator cascade`);
    const metadataSql = `select p.oid,p.proowner,p.proacl::text,p.prosecdef,p.proconfig,p.proargdefaults::text
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.prokind='f' order by p.oid`;
    const functions = (await isolated.query(metadataSql)).rows;
    const policies = (await isolated.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
    const snapshotSql = `select (select jsonb_agg(b order by b.id) from public.inventory_balances b) balances,
      (select jsonb_agg(m order by m.id) from public.inventory_movements m) movements,
      (select jsonb_agg(a order by a.id) from public.audit_logs a) audit,
      (select jsonb_agg(j order by j.id) from public.journal_entries j) entries,
      (select jsonb_agg(l order by l.id) from public.journal_lines l) lines`;
    const records = (await isolated.query(snapshotSql)).rows;
    await isolated.exec('set role pos_migrator');
    await isolated.exec(repair);
    await isolated.exec(repair);
    await isolated.exec('reset role');
    assert.deepEqual((await isolated.query(metadataSql)).rows.filter(row => functions.some(f => f.oid === row.oid)), functions);
    assert.deepEqual((await isolated.query('select * from pg_policies order by schemaname,tablename,policyname')).rows, policies);
    assert.deepEqual((await isolated.query(snapshotSql)).rows, records);
    const { rows: [unrelated] } = await isolated.query("select prosrc from pg_proc where oid='public.unrelated_auth_reader()'::regprocedure");
    assert.match(unrelated.prosrc, /auth\.uid\(\)/);
    const { rows: remaining } = await isolated.query(`select p.proname from pg_proc p join pg_roles r on r.oid=p.proowner
      where r.rolname in ('pos_identity','pos_writer','pos_auditor') and strpos(p.prosrc,'auth.uid()')>0`);
    assert.deepEqual(remaining, []);
    const name = `After managed Auth repair ${randomUUID()}`;
    const category = await data.insert('categories', { organization_id: data.org, name });
    const { rows: [actor] } = await isolated.query("select actor_id from public.audit_logs where table_name='categories' and record_id=$1", [category]);
    assert.equal(actor.actor_id, data.users.owner);
    await denied(() => data.query('ownerB', "insert into public.categories(organization_id,name) values ($1,'Foreign category')", [data.org]));
    assert.deepEqual(await data.query('outsider', 'select id from public.categories'), []);
  } finally { await isolated.close(); }
});

test('request identity accepts only the request subject and fails closed on missing or malformed claims', async () => {
  await db.exec('begin');
  try {
    const claim = async (claims, legacy = '') => {
      await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)", [claims, legacy]);
      return (await db.query('select private.request_user_id() as id')).rows[0].id;
    };
    assert.equal(await claim(''), null);
    assert.equal(await claim('{}'), null);
    assert.equal(await claim('{"sub":""}'), null);
    assert.equal(await claim(JSON.stringify({ user_metadata: { sub: f.users.owner, role: 'owner' }, organization_id: f.org })), null);
    assert.equal(await claim(JSON.stringify({ sub: f.users.cashier, user_metadata: { sub: f.users.owner } })), f.users.cashier);
    assert.equal(await claim('', f.users.cashier), f.users.cashier);
    assert.equal(await claim('{}', f.users.owner), null, 'Modern claims must not fall back to a stale legacy subject');
    await assert.rejects(() => claim('{"sub":"not-a-uuid"}'), e => e.code === '22P02');
  } finally { await db.exec('rollback'); }
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", ['not-json']);
    await assert.rejects(() => db.query('select private.request_user_id()'), e => e.code === '22P02');
  } finally { await db.exec('rollback'); }
  await denied(() => asUser(db, f.users.cashier, 'select private.request_user_id()'));
  await denied(() => asUser(db, null, 'select private.request_user_id()'));
});
