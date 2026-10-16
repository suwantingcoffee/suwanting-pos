# Dashboard and reporting

The dashboard (`/`) and reports (`/reports`) call the `analytics_report` Supabase
RPC. The RPC performs aggregation in PostgreSQL and validates the organization,
report role, requested outlets, products, categories, date range, and payment
method. It is executable by authenticated users, but only `owner`, `admin`,
`manager`, and `finance_staff` can retrieve a report. A selected outlet must
also be within the caller's authorized outlet scope. CSV exports use the
already-filtered RPC response; they do not query or export an unfiltered client
dataset.

## Filters and date ranges

- `from` is inclusive and `until` is exclusive; maximum range is 3,660 days.
- Omitting an outlet filter means all outlets the caller is authorized to see.
- Product and category filters apply to order lines and applicable stock,
  waste, production, and payment-reconciliation rows.
- A payment-method filter selects orders that have a payment using that method.
  Sales metrics remain order-level totals for those orders. The payment-method
  summary and reconciliation show amounts recorded against each actual method,
  which is important for split payments.
- Graph buckets can be daily, weekly, or monthly.

## Metric definitions

- **Gross sales** are the matched order-line values before the order discount.
- **Discounts** are the order discount allocated proportionally across lines.
- **Net sales** are line values after allocated discounts, less refunds excluding
  their refunded tax. Refunds are attributed to their refund date and allocated
  proportionally to matching lines. Refunded tax is shown separately.
- Only completed orders contribute to sales; the POS finalization RPC marks
  those orders paid. Pending/failed payment attempts are shown in payment
  reconciliation and do not become sales or cash received.
- **COGS** uses the finalized order-item cost snapshot. Gross profit is net
  sales minus COGS.
- **Net profit (recorded basis)** is gross profit plus other income, less
  recorded operating expenses, loan interest and fees, waste, and cash
  shortages. Loan principal, owner capital, asset purchases, and sales tax are
  not treated as expenses. This is not a complete statutory profit figure:
  depreciation, income tax, accruals, and legacy inventory without order cost
  snapshots are not included.
- **Cashflow** is the sum of recorded cash movements in the selected period.
  Account balances are calculated through the exclusive end date. Inventory
  quantity, valuation, and low-stock warnings use the current inventory
  balance, not a historical stock snapshot for the selected period.
- Cashier sales show completed order totals. Payment-method receipts show the
  recorded amount received, not the full order value for split-payment orders.

Money is kept numeric in report results and formatted as IDR in the interface.
CSV files contain numeric values without localized thousands separators, ISO
dates, UTF-8 BOM, quoted/escaped cells, and protection against spreadsheet
formula injection.

The database implementation is in
[`20261016001800_reporting.sql`](../supabase/migrations/20261016001800_reporting.sql);
the typed RPC adapter and report UI are in
[`reports-api.ts`](../frontend/src/features/reports/reports-api.ts) and
[`reports-page.tsx`](../frontend/src/features/reports/reports-page.tsx).
