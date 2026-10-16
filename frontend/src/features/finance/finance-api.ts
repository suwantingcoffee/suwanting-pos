import { dbClient } from "@/lib/catalog-api";
import type { Database, Json } from "@/lib/database.types";

export type FinanceOverview = {
  gross_sales: number;
  payments_received: number;
  refunds: number;
  pending_settlement: number;
  cash_in: number;
  cash_out: number;
  other_income: number;
  operating_expenses: number;
  asset_purchases: number;
  owner_capital: number;
  loan_proceeds: number;
  loan_principal_paid: number;
  loan_interest_paid: number;
  loan_fees_paid: number;
  open_shifts: number;
  unreconciled_shifts: number;
  account_balances: { id: string; name: string; kind: string; balance: number }[];
};

function record(value: Json): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Respons ringkasan keuangan tidak valid.");
  }
  return value;
}

function finite(value: Json | undefined, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Nilai ${key} pada ringkasan keuangan tidak valid.`);
  }
  return value;
}

export async function financeOverview(
  organization: string,
  outlet: string,
  from: string,
  until: string,
): Promise<FinanceOverview> {
  const { data, error } = await dbClient().rpc("finance_overview", {
    p_organization_id: organization,
    p_outlet_id: outlet,
    p_from: from,
    p_until: until,
  });
  if (error) throw error;
  const result = record(data);
  const accountBalances = result.account_balances;
  if (!Array.isArray(accountBalances)) {
    throw new Error("Saldo akun pada ringkasan keuangan tidak valid.");
  }
  const accounts = accountBalances.map((value) => {
    const account = record(value);
    if (
      typeof account.id !== "string" ||
      typeof account.name !== "string" ||
      typeof account.kind !== "string"
    ) {
      throw new Error("Akun pada ringkasan keuangan tidak valid.");
    }
    return {
      id: account.id,
      name: account.name,
      kind: account.kind,
      balance: finite(account.balance, "saldo akun"),
    };
  });
  return {
    gross_sales: finite(result.gross_sales, "omzet"),
    payments_received: finite(result.payments_received, "penerimaan pembayaran"),
    refunds: finite(result.refunds, "refund"),
    pending_settlement: finite(result.pending_settlement, "pembayaran tertunda"),
    cash_in: finite(result.cash_in, "kas masuk"),
    cash_out: finite(result.cash_out, "kas keluar"),
    other_income: finite(result.other_income, "pemasukan lain"),
    operating_expenses: finite(result.operating_expenses, "beban operasional"),
    asset_purchases: finite(result.asset_purchases, "pembelian aset"),
    owner_capital: finite(result.owner_capital, "modal pemilik"),
    loan_proceeds: finite(result.loan_proceeds, "penerimaan pinjaman"),
    loan_principal_paid: finite(result.loan_principal_paid, "pokok pinjaman"),
    loan_interest_paid: finite(result.loan_interest_paid, "bunga pinjaman"),
    loan_fees_paid: finite(result.loan_fees_paid, "biaya pinjaman"),
    open_shifts: finite(result.open_shifts, "shift aktif"),
    unreconciled_shifts: finite(result.unreconciled_shifts, "shift belum direkonsiliasi"),
    account_balances: accounts,
  };
}

type Mutation =
  | "record_income"
  | "record_capital_contribution"
  | "record_asset_purchase"
  | "record_expense_once"
  | "record_loan"
  | "record_loan_payment"
  | "reconcile_cashier_shift"
  | "reverse_journal_entry"
  | "post_journal";

type Args<N extends Mutation> = Omit<
  Database["public"]["Functions"][N]["Args"],
  "p_idempotency_key"
>;

export async function postFinanceMutation<N extends Mutation>(
  name: N,
  args: Args<N>,
  identity: { user: string; organization: string; outlet: string },
) {
  const storageKey = `suwanting-pos-finance:${identity.user}:${identity.organization}:${identity.outlet}:${name}`;
  const payload = JSON.stringify(args);
  let key: string;
  const stored = sessionStorage.getItem(storageKey);
  if (stored) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error("Data pemulihan keuangan rusak. Periksa jurnal sebelum mengulang.");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("key" in parsed) ||
      typeof parsed.key !== "string" ||
      !("payload" in parsed) ||
      parsed.payload !== payload
    ) {
      throw new Error(
        "Request keuangan sebelumnya belum dipastikan. Muat ulang data atau periksa jurnal sebelum mengirim perubahan lain.",
      );
    }
    key = parsed.key;
  } else {
    key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, JSON.stringify({ key, payload }));
  }
  const request = {
    ...args,
    p_idempotency_key: key,
  } as Database["public"]["Functions"][N]["Args"];
  const { data, error } = await dbClient().rpc(name, request);
  if (error) {
    if (error.code && /^[0-9A-Z]{5}$/.test(error.code)) {
      sessionStorage.removeItem(storageKey);
    }
    throw error;
  }
  sessionStorage.removeItem(storageKey);
  return data as Database["public"]["Functions"][N]["Returns"];
}
