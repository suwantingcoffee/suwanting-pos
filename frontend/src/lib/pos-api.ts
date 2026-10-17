import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type CheckoutArgs = Database["public"]["Functions"]["checkout"]["Args"];

function client() {
  if (!supabase) throw new Error("Supabase belum dikonfigurasi.");
  return supabase;
}
async function rpc<N extends keyof Database["public"]["Functions"]>(name: N, args: Database["public"]["Functions"][N]["Args"]) {
  const { data, error } = await client().rpc(name, args);
  if (error) throw error;
  return data as Database["public"]["Functions"][N]["Returns"];
}

export async function getMyMemberships() {
  const db = client();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error("Silakan login terlebih dahulu.");
  const { data, error } = await db.from("organization_members")
    .select("id, organization_id, outlet_id, role, is_active")
    .eq("user_id", user.id).eq("is_active", true);
  if (error) throw error;
  return data;
}

/** Provision first workspace on a new database; existing tenants never auto-assign. */
export async function bootstrapWorkspace(organizationName = "Suwanting Coffee", outletName = "Outlet Utama") {
  return rpc("bootstrap_workspace", { p_organization_name: organizationName, p_outlet_name: outletName });
}

// The selected organization/outlet are selectors, never proof of authorization.
// Persist this UUID with the cart until a retry succeeds after a network error.
export async function checkout(args: CheckoutArgs) {
  const { data, error } = await client().rpc("checkout", args);
  if (error) throw error;
  return data;
}

export async function listProducts(organizationId: string) {
  const { data, error } = await client().from("products")
    .select("id, name, description, category_id")
    .eq("organization_id", organizationId).is("archived_at", null).order("name");
  if (error) throw error;
  return data;
}

export type CatalogItem = {
  id: string; product_id: string; product_name: string; variant_name: string; sku: string;
  price: number; photo_url: string | null; sale_quantity: number; consumption_mode: string; available: number | null;
};
function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Respons POS tidak valid.");
  return value as Record<string, unknown>;
}
function numberField(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Field ${key} tidak valid.`);
  return value;
}
export async function posCatalog(organizationId: string, outletId: string, search = "", categoryId: string | null = null, page = 1) {
  const { data, error } = await client().rpc("pos_catalog", { p_organization_id: organizationId, p_outlet_id: outletId, p_search: search, p_category_id: categoryId, p_page: page });
  if (error) throw error;
  const result = jsonRecord(data); const rows = result.rows;
  if (!Array.isArray(rows) || typeof result.count !== "number") throw new Error("Respons katalog POS tidak valid.");
  return { count: result.count, rows: rows.map(value => {
    const row = jsonRecord(value);
    for (const key of ["id", "product_id", "product_name", "variant_name", "sku", "consumption_mode"]) if (typeof row[key] !== "string") throw new Error(`Field ${key} tidak valid.`);
    if (row.photo_url !== null && typeof row.photo_url !== "string") throw new Error("Foto produk tidak valid.");
    return { id: row.id as string, product_id: row.product_id as string, product_name: row.product_name as string, variant_name: row.variant_name as string,
      sku: row.sku as string, price: numberField(row, "price"), photo_url: row.photo_url as string | null, sale_quantity: numberField(row, "sale_quantity"),
      consumption_mode: row.consumption_mode as string, available: row.available === null ? null : numberField(row, "available") } satisfies CatalogItem;
  }) };
}
export type PaymentPart = { cash_account_id: string; method: "cash" | "transfer" | "qris" | "card"; amount: number; tendered_amount?: number };
export type PosItem = { variant_id: string; quantity: number; note?: string };
export async function holdOrder(args: Database["public"]["Functions"]["hold_order"]["Args"]) { return rpc("hold_order", args); }
export async function finalizePosOrder(args: Database["public"]["Functions"]["finalize_pos_order"]["Args"]) { return rpc("finalize_pos_order", args); }
export async function addPaymentAttempt(args: Database["public"]["Functions"]["add_payment_attempt"]["Args"]) { return rpc("add_payment_attempt", args); }
export async function resolvePaymentAttempt(args: Database["public"]["Functions"]["resolve_payment_attempt"]["Args"]) { return rpc("resolve_payment_attempt", args); }
export async function resumeOrder(args: Database["public"]["Functions"]["resume_order"]["Args"]) { return rpc("resume_order", args); }
export async function voidOrder(args: Database["public"]["Functions"]["void_order"]["Args"]) { return rpc("void_order", args); }
export async function refundPosPayment(args: Database["public"]["Functions"]["refund_pos_payment"]["Args"]) { return rpc("refund_pos_payment", args); }

async function allOrderRows<T>(read: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const response = await read(offset); if (response.error) throw response.error;
    if (!response.data) throw new Error("Detail transaksi tidak lengkap.");
    rows.push(...response.data); if (response.data.length < 500) return rows;
  }
}
export async function orderDetail(org: string, outlet: string, id: string) {
  const db = client();
  const [order, items, payments, attempts, refunds] = await Promise.all([
    db.from("orders").select("*").eq("organization_id", org).eq("outlet_id", outlet).eq("id", id).single(),
    allOrderRows(offset => db.from("order_items").select("*").eq("organization_id", org).eq("outlet_id", outlet).eq("order_id", id).order("created_at").order("id").range(offset, offset+499)),
    allOrderRows(offset => db.from("payments").select("*").eq("organization_id", org).eq("outlet_id", outlet).eq("order_id", id).order("created_at").order("id").range(offset, offset+499)),
    allOrderRows(offset => db.from("pos_payment_attempts").select("*").eq("organization_id", org).eq("outlet_id", outlet).eq("order_id", id).order("created_at").order("id").range(offset, offset+499)),
    allOrderRows(offset => db.from("refunds").select("*").eq("organization_id", org).eq("outlet_id", outlet).eq("order_id", id).order("created_at").order("id").range(offset, offset+499)),
  ]);
  if (order.error) throw order.error;
  if (!order.data) throw new Error("Detail transaksi tidak lengkap.");
  return { order: order.data, items, payments, attempts, refunds };
}
export type OrderDetail = Awaited<ReturnType<typeof orderDetail>>;
export type HistoryFilters = { search?: string; from?: string; until?: string; status?: string; payment?: string; openOnly?: boolean };
export async function orderHistory(org: string, outlet: string, page: number, filters: HistoryFilters = {}) {
  let query = client().from("orders").select("*", { count: "exact" }).eq("organization_id", org).eq("outlet_id", outlet);
  if (filters.search) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.search)) query = query.eq("id", filters.search);
    else query = query.ilike("receipt_number", `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.until) query = query.lt("created_at", filters.until);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.payment) query = query.eq("payment_status", filters.payment);
  if (filters.openOnly) query = query.in("status", ["held", "pending"]);
  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id").range((page-1)*20, page*20-1);
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0 };
}
