import { randomUUID } from 'node:crypto';
import { asUser } from './helpers.mjs';

export async function fixture(db) {
  const users = {};
  for (const name of ['owner', 'admin', 'manager', 'cashier', 'inventory_staff', 'finance_staff', 'ownerB', 'outsider', 'inactive']) {
    users[name] = randomUUID();
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)',
      [users[name], `${name}@example.test`, JSON.stringify({ role: 'owner', organization_id: randomUUID() })]);
  }
  const query = (user, sql, params) => asUser(db, users[user], sql, params);
  const rpc = async (user, name, params) => {
    const entries = Object.entries(params);
    const [row] = await query(user, `select public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(',')}) as value`, entries.map(([, value]) => value));
    return row.value;
  };
  const insert = async (table, data, user = 'owner') => {
    const entries = Object.entries(data);
    const [row] = await query(user, `insert into public.${table}(${entries.map(([k]) => k).join(',')}) values (${entries.map((_, i) => `$${i + 1}`).join(',')}) returning id`, entries.map(([, v]) => v));
    return row.id;
  };
  const org = await rpc('owner', 'create_organization', { p_name: 'Suwanting A' });
  const orgB = await rpc('ownerB', 'create_organization', { p_name: 'Suwanting B' });
  const outlet = await insert('outlets', { organization_id: org, code: 'A1', name: 'A1' });
  const outlet2 = await insert('outlets', { organization_id: org, code: 'A2', name: 'A2' });
  const outletB = await insert('outlets', { organization_id: orgB, code: 'B1', name: 'B1' }, 'ownerB');
  for (const role of ['admin', 'manager', 'cashier', 'inventory_staff', 'finance_staff']) {
    await rpc('owner', 'set_member', { p_organization_id: org, p_user_id: users[role], p_role: role,
      p_outlet_id: ['manager','cashier','inventory_staff'].includes(role) ? outlet : null });
  }
  await rpc('owner', 'set_member', { p_organization_id: org, p_user_id: users.inactive, p_role: 'admin', p_is_active: false });
  const unit = await insert('units', { organization_id: org, code: 'pc', name: 'Piece' });
  const unitB = await insert('units', { organization_id: orgB, code: 'pc', name: 'Piece' }, 'ownerB');
  const category = await insert('categories', { organization_id: org, name: 'Coffee' });
  const product = await insert('products', { organization_id: org, category_id: category, name: 'Arabica' });
  const productB = await insert('products', { organization_id: orgB, name: 'B private' }, 'ownerB');
  const variant = await insert('product_variants', { organization_id: org, product_id: product, unit_id: unit, sku: 'RAW', name: 'Raw', price: 25000 });
  const output = await insert('product_variants', { organization_id: org, product_id: product, unit_id: unit, sku: 'ROAST', name: 'Roasted', price: 35000 });
  const variantB = await insert('product_variants', { organization_id: orgB, product_id: productB, unit_id: unitB, sku: 'B', name: 'B', price: 99999 }, 'ownerB');
  const supplier = await insert('suppliers', { organization_id: org, name: 'Farm' });
  const customer = await insert('customers', { organization_id: org, name: 'Development customer' });
  const account = await insert('cash_accounts', { organization_id: org, outlet_id: outlet, name: 'Drawer', kind: 'cash' });
  const accountBank = await insert('cash_accounts', { organization_id: org, outlet_id: outlet, name: 'Settlement bank', kind: 'bank' });
  const account2 = await insert('cash_accounts', { organization_id: org, outlet_id: outlet2, name: 'Other drawer', kind: 'cash' });
  const promotion = await insert('promotions', { organization_id: org, outlet_id: outlet, code: 'DEV10', discount_percent: 10,
    starts_at: '2020-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
  const recipe = await rpc('owner', 'save_recipe', { p_organization_id: org, p_recipe_id: null, p_output_variant_id: output,
    p_name: 'Roast', p_yield_quantity: 1, p_output_unit_id: unit, p_kind: 'roasting',
    p_items: JSON.stringify([{ variant_id: variant, quantity: 2, unit_id: unit }]) });
  const expenseCategory = await insert('expense_categories', { organization_id: org, name: 'Utilities' });
  await rpc('owner', 'record_asset_purchase', { p_organization_id: org, p_outlet_id: outlet, p_cash_account_id: account,
    p_name: 'Grinder', p_acquired_on: '2026-01-01', p_amount: 1000000, p_useful_life_months: 60, p_idempotency_key: randomUUID() });
  await rpc('owner', 'record_capital_contribution', { p_organization_id: org, p_outlet_id: outlet, p_cash_account_id: account,
    p_amount: 250000, p_contributor: 'Owner fixture', p_description: 'Initial capital', p_idempotency_key: randomUUID() });
  await rpc('owner', 'record_income', { p_organization_id: org, p_outlet_id: outlet, p_cash_account_id: account,
    p_amount: 5000, p_description: 'Other income fixture', p_received_on: '2026-10-16', p_idempotency_key: randomUUID() });
  await insert('application_settings', { organization_id: org, key: 'receipt_footer', value: 'Terima kasih' });
  await rpc('inventory_staff', 'adjust_inventory', { p_organization_id: org, p_outlet_id: outlet, p_variant_id: variant, p_quantity: 100, p_reason: 'Opening stock' });
  const po = await rpc('inventory_staff', 'create_purchase_order', { p_organization_id: org, p_outlet_id: outlet, p_supplier_id: supplier,
    p_number: 'PO-001', p_items: JSON.stringify([{ variant_id: variant, quantity: 10, unit_cost: 10000 }]) });
  await rpc('manager', 'approve_purchase_order', { p_purchase_order_id: po });
  await rpc('inventory_staff', 'receive_purchase_order', { p_purchase_order_id: po });
  await rpc('inventory_staff', 'produce_batch', { p_organization_id: org, p_outlet_id: outlet, p_recipe_id: recipe, p_quantity: 2 });
  await rpc('inventory_staff', 'record_waste', { p_organization_id: org, p_outlet_id: outlet, p_variant_id: variant, p_quantity: 1, p_reason: 'Spill' });
  const shift = await rpc('cashier', 'open_shift', { p_organization_id: org, p_outlet_id: outlet, p_cash_account_id: account, p_opening_cash: 100000 });
  const checkoutArgs = { p_organization_id: org, p_outlet_id: outlet, p_shift_id: shift, p_idempotency_key: randomUUID(),
    p_items: JSON.stringify([{ variant_id: variant, quantity: 2 }]), p_cash_account_id: account, p_customer_id: customer, p_promotion_code: 'DEV10' };
  const order = await rpc('cashier', 'checkout', checkoutArgs);
  await rpc('manager', 'refund_order', { p_order_id: order, p_amount: 5000, p_reason: 'Partial refund', p_idempotency_key: randomUUID() });
  await rpc('finance_staff', 'record_expense', { p_organization_id: org, p_outlet_id: outlet, p_category_id: expenseCategory,
    p_cash_account_id: account, p_amount: 10000, p_description: 'Electricity' });
  const loan = await rpc('finance_staff', 'create_loan', { p_organization_id: org, p_outlet_id: outlet, p_cash_account_id: account,
    p_lender: 'Development lender', p_principal: 1000000, p_interest_percent: 6, p_started_on: '2026-01-01', p_due_on: '2027-01-01' });
  await rpc('finance_staff', 'pay_loan', { p_loan_id: loan, p_outlet_id: outlet, p_cash_account_id: account, p_principal: 100000, p_interest: 5000 });
  const reconciliationShift = await rpc('owner', 'open_shift', { p_organization_id: org, p_outlet_id: outlet2, p_cash_account_id: account2, p_opening_cash: 0 });
  await rpc('owner', 'close_shift', { p_shift_id: reconciliationShift, p_closing_cash: 0 });
  await rpc('finance_staff', 'reconcile_cashier_shift', { p_shift_id: reconciliationShift, p_actual_cash: 0, p_idempotency_key: randomUUID() });
  const gl = await query('finance_staff', 'select id,code from public.financial_accounts where organization_id=$1 order by code', [org]);
  const lines = [{ account_id: gl[0].id, debit: 100, credit: 0 }, { account_id: gl[1].id, debit: 0, credit: 100 }];
  await rpc('finance_staff', 'post_journal', { p_organization_id: org, p_outlet_id: outlet, p_description: 'Opening journal',
    p_entry_date: '2026-10-16', p_idempotency_key: randomUUID(), p_lines: JSON.stringify(lines) });
  const held = await rpc('cashier','hold_order',{p_organization_id:org,p_outlet_id:outlet,p_shift_id:shift,p_idempotency_key:randomUUID(),p_items:JSON.stringify([{variant_id:variant,quantity:1}])});
  await rpc('cashier','finalize_pos_order',{p_order_id:held,p_idempotency_key:randomUUID(),p_payments:JSON.stringify([{cash_account_id:accountBank,method:'transfer',amount:25000}])});
  return { users, query, rpc, insert, org, orgB, outlet, outlet2, outletB, unit, unitB, category, product, productB,
    variant, variantB, output, supplier, customer, account, accountBank, account2, promotion, recipe, expenseCategory, po, shift, reconciliationShift, order, loan, gl, lines, checkoutArgs };
}
