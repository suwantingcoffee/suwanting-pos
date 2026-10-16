import { dbClient } from "@/lib/catalog-api";
import type { Json } from "@/lib/database.types";

export type ReportFilters = {
  organization: string;
  from: string;
  until: string;
  outlets: string[];
  product: string;
  category: string;
  paymentMethod: string;
  grain: "day" | "week" | "month";
};

export type ReportData = {
  sales: {
    gross_sales: number;
    discounts: number;
    refunds: number;
    refund_tax: number;
    net_sales: number;
    sales_tax: number;
    transactions: number;
    average_transaction: number;
    cogs: number;
    gross_profit: number;
  };
  profit_loss: {
    net_sales: number;
    cogs: number;
    gross_profit: number;
    other_income: number;
    operating_expenses: number;
    interest_expense: number;
    loan_fees: number;
    waste_cost: number;
    cash_shortage: number;
    net_profit: number;
  };
  cashflow: { cash_in: number; cash_out: number; net_cashflow: number };
  series: { period: string; gross_sales: number; net_sales: number; transactions: number }[];
  products: {
    variant_id: string; sku: string | null; variant: string | null; product_label: string;
    category_label: string; quantity: number; gross_sales: number; discounts: number;
    net_sales: number; cogs: number; gross_profit: number; margin_percent: number;
  }[];
  categories: {
    category_id: string | null; category_label: string; quantity: number; gross_sales: number;
    discounts: number; net_sales: number; cogs: number; gross_profit: number;
  }[];
  outlets: {
    outlet_id: string; outlet_name: string; transactions: number; gross_sales: number;
    net_sales: number; cogs: number; gross_profit: number;
  }[];
  payment_methods: { method: string; received: number; transactions: number }[];
  expenses: { id: string; incurred_on: string; description: string; amount: number; category: string | null; account: string | null }[];
  cash_movements: { date: string; outlet_id: string; account_id: string; account: string; reason: string; amount: number; reference_id: string | null }[];
  account_balances: { id: string; name: string; kind: string; outlet_id: string; balance: number }[];
  inventory: {
    quantity: number; valuation: number;
    items: { variant_id: string; sku: string; product: string; variant: string; quantity: number; inventory_value: number; minimum_stock: number }[];
  };
  low_stock: { variant_id: string; sku: string; product: string; variant: string; quantity: number; inventory_value: number; minimum_stock: number }[];
  inventory_movements: { id: string; created_at: string; outlet_id: string; variant_id: string; sku: string; product: string; reason: string; quantity: number; note: string }[];
  waste: { id: string; created_at: string; outlet_id: string; sku: string; product: string; variant: string; quantity: number; reason: string }[];
  production: { id: string; produced_at: string; outlet_id: string; batch_kind: string; output_quantity: number; output_cost: number; input_quantity: number }[];
  payment_reconciliation: { method: string; status: string; attempts: number; amount: number }[];
  cashiers: { cashier_id: string; cashier_name: string; transactions: number; total_sales: number; average_transaction: number; cogs: number }[];
  recent_transactions: { id: string; receipt_number: string | null; finalized_at: string; outlet_id: string; outlet_name: string; total: number; payment_status: string; cashier_id: string; cashier_name: string }[];
};

function record(value: Json | undefined, label: string): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Respons ${label} tidak valid.`);
  }
  return value;
}

function numeric(row: Record<string, Json | undefined>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Nilai ${key} pada laporan tidak valid.`);
  }
  return value;
}

function text(row: Record<string, Json | undefined>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Field ${key} pada laporan tidak valid.`);
  return value;
}

function nullableText(row: Record<string, Json | undefined>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Field ${key} pada laporan tidak valid.`);
  return value;
}

function rows<T>(value: Json | undefined, label: string, parse: (row: Record<string, Json | undefined>) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`Daftar ${label} pada laporan tidak valid.`);
  return value.map((item) => parse(record(item, label)));
}

function metrics(value: Json | undefined, fields: string[], label: string): Record<string, number> {
  const item = record(value, label);
  return Object.fromEntries(fields.map((field) => [field, numeric(item, field)]));
}

export async function analyticsReport(filters: ReportFilters): Promise<ReportData> {
  const { data, error } = await dbClient().rpc("analytics_report", {
    p_organization_id: filters.organization,
    p_from: filters.from,
    p_until: filters.until,
    ...(filters.outlets.length ? { p_outlet_ids: filters.outlets } : {}),
    ...(filters.product ? { p_product_id: filters.product } : {}),
    ...(filters.category ? { p_category_id: filters.category } : {}),
    ...(filters.paymentMethod ? { p_payment_method: filters.paymentMethod } : {}),
    p_grain: filters.grain,
  });
  if (error) throw error;
  const result = record(data, "laporan");
  const sales = metrics(result.sales, ["gross_sales", "discounts", "refunds", "refund_tax", "net_sales", "sales_tax", "transactions", "average_transaction", "cogs", "gross_profit"], "penjualan");
  const profit = metrics(result.profit_loss, ["net_sales", "cogs", "gross_profit", "other_income", "operating_expenses", "interest_expense", "loan_fees", "waste_cost", "cash_shortage", "net_profit"], "laba rugi");
  const cashflow = metrics(result.cashflow, ["cash_in", "cash_out", "net_cashflow"], "cashflow");
  const inventoryRecord = record(result.inventory, "persediaan");
  const inventory = {
    quantity: numeric(inventoryRecord, "quantity"),
    valuation: numeric(inventoryRecord, "valuation"),
    items: rows(inventoryRecord.items, "valuasi persediaan", (row) => ({
      variant_id: text(row, "variant_id"), sku: text(row, "sku"), product: text(row, "product"),
      variant: text(row, "variant"), quantity: numeric(row, "quantity"),
      inventory_value: numeric(row, "inventory_value"), minimum_stock: numeric(row, "minimum_stock"),
    })),
  };
  return {
    sales: sales as ReportData["sales"],
    profit_loss: profit as ReportData["profit_loss"],
    cashflow: cashflow as ReportData["cashflow"],
    series: rows(result.series, "seri penjualan", (row) => ({
      period: text(row, "period"), gross_sales: numeric(row, "gross_sales"),
      net_sales: numeric(row, "net_sales"), transactions: numeric(row, "transactions"),
    })),
    products: rows(result.products, "produk", (row) => ({
      variant_id: text(row, "variant_id"), sku: nullableText(row, "sku"), variant: nullableText(row, "variant"),
      product_label: text(row, "product_label"), category_label: text(row, "category_label"),
      quantity: numeric(row, "quantity"), gross_sales: numeric(row, "gross_sales"), discounts: numeric(row, "discounts"),
      net_sales: numeric(row, "net_sales"), cogs: numeric(row, "cogs"), gross_profit: numeric(row, "gross_profit"),
      margin_percent: numeric(row, "margin_percent"),
    })),
    categories: rows(result.categories, "kategori", (row) => ({
      category_id: nullableText(row, "category_id"), category_label: text(row, "category_label"), quantity: numeric(row, "quantity"),
      gross_sales: numeric(row, "gross_sales"), discounts: numeric(row, "discounts"), net_sales: numeric(row, "net_sales"),
      cogs: numeric(row, "cogs"), gross_profit: numeric(row, "gross_profit"),
    })),
    outlets: rows(result.outlets, "outlet", (row) => ({
      outlet_id: text(row, "outlet_id"), outlet_name: text(row, "outlet_name"), transactions: numeric(row, "transactions"),
      gross_sales: numeric(row, "gross_sales"), net_sales: numeric(row, "net_sales"), cogs: numeric(row, "cogs"),
      gross_profit: numeric(row, "gross_profit"),
    })),
    payment_methods: rows(result.payment_methods, "metode pembayaran", (row) => ({
      method: text(row, "method"), received: numeric(row, "received"), transactions: numeric(row, "transactions"),
    })),
    expenses: rows(result.expenses, "beban", (row) => ({
      id: text(row, "id"), incurred_on: text(row, "incurred_on"), description: text(row, "description"),
      amount: numeric(row, "amount"), category: nullableText(row, "category"), account: nullableText(row, "account"),
    })),
    cash_movements: rows(result.cash_movements, "mutasi kas", (row) => ({
      date: text(row, "date"), outlet_id: text(row, "outlet_id"), account_id: text(row, "account_id"),
      account: text(row, "account"), reason: text(row, "reason"), amount: numeric(row, "amount"),
      reference_id: nullableText(row, "reference_id"),
    })),
    account_balances: rows(result.account_balances, "saldo akun", (row) => ({
      id: text(row, "id"), name: text(row, "name"), kind: text(row, "kind"),
      outlet_id: text(row, "outlet_id"), balance: numeric(row, "balance"),
    })),
    inventory,
    low_stock: rows(result.low_stock, "stok menipis", (row) => ({
      variant_id: text(row, "variant_id"), sku: text(row, "sku"), product: text(row, "product"),
      variant: text(row, "variant"), quantity: numeric(row, "quantity"), inventory_value: numeric(row, "inventory_value"),
      minimum_stock: numeric(row, "minimum_stock"),
    })),
    inventory_movements: rows(result.inventory_movements, "mutasi persediaan", (row) => ({
      id: text(row, "id"), created_at: text(row, "created_at"), outlet_id: text(row, "outlet_id"),
      variant_id: text(row, "variant_id"), sku: text(row, "sku"), product: text(row, "product"),
      reason: text(row, "reason"), quantity: numeric(row, "quantity"), note: text(row, "note"),
    })),
    waste: rows(result.waste, "waste", (row) => ({
      id: text(row, "id"), created_at: text(row, "created_at"), outlet_id: text(row, "outlet_id"),
      sku: text(row, "sku"), product: text(row, "product"), variant: text(row, "variant"),
      quantity: numeric(row, "quantity"), reason: text(row, "reason"),
    })),
    production: rows(result.production, "produksi", (row) => ({
      id: text(row, "id"), produced_at: text(row, "produced_at"), outlet_id: text(row, "outlet_id"),
      batch_kind: text(row, "batch_kind"), output_quantity: numeric(row, "output_quantity"),
      output_cost: numeric(row, "output_cost"), input_quantity: numeric(row, "input_quantity"),
    })),
    payment_reconciliation: rows(result.payment_reconciliation, "rekonsiliasi pembayaran", (row) => ({
      method: text(row, "method"), status: text(row, "status"), attempts: numeric(row, "attempts"), amount: numeric(row, "amount"),
    })),
    cashiers: rows(result.cashiers, "kasir", (row) => ({
      cashier_id: text(row, "cashier_id"), cashier_name: text(row, "cashier_name"),
      transactions: numeric(row, "transactions"), total_sales: numeric(row, "total_sales"),
      average_transaction: numeric(row, "average_transaction"), cogs: numeric(row, "cogs"),
    })),
    recent_transactions: rows(result.recent_transactions, "transaksi terbaru", (row) => ({
      id: text(row, "id"), receipt_number: nullableText(row, "receipt_number"), finalized_at: text(row, "finalized_at"),
      outlet_id: text(row, "outlet_id"), outlet_name: text(row, "outlet_name"), total: numeric(row, "total"),
      payment_status: text(row, "payment_status"), cashier_id: text(row, "cashier_id"), cashier_name: text(row, "cashier_name"),
    })),
  };
}
