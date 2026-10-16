import { supabase } from "@/lib/supabase";
import type { Database, Json } from "@/lib/database.types";

export type TableName = keyof Database["public"]["Tables"];
export type Row<T extends TableName> = Database["public"]["Tables"][T]["Row"];
export type Editable = "categories" | "suppliers" | "storage_locations" | "units";
export type Page<T> = { rows: T[]; count: number };
export const pageSize = 20;
export function dbClient() {
  if (!supabase) throw new Error("Isi konfigurasi Supabase pada frontend/.env.local terlebih dahulu.");
  return supabase;
}
export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return error.message;
  return "Permintaan gagal. Periksa koneksi lalu coba kembali.";
}
export const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 2 }).format(value);
export const amount = (value: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 }).format(value);
export type Filters = { outlet?: string; search?: string; searchColumn?: string; status?: string; category?: string; active?: boolean; archived?: boolean; parent?: [string, string]; reason?: string; variant?: string };
export async function readPage<T extends TableName>(table: T, org: string, page: number, filters: Filters = {}, size = pageSize): Promise<Page<Row<T>>> {
  let query = dbClient().from(table as TableName).select("*", { count: "exact" }).filter("organization_id", "eq", org);
  if (filters.outlet) query = query.filter("outlet_id", "eq", filters.outlet);
  if (filters.search) query = query.ilike(filters.searchColumn ?? "name", `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`);
  if (filters.status) query = query.filter("status", "eq", filters.status);
  if (filters.reason) query = query.filter("reason", "eq", filters.reason);
  if (filters.category) query = query.filter("category_id", "eq", filters.category);
  if (filters.active !== undefined) query = query.filter("is_active", "eq", filters.active);
  if (filters.archived !== undefined) query = filters.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (filters.parent) query = query.filter(filters.parent[0], "eq", filters.parent[1]);
  if (filters.variant) query = query.filter("variant_id", "eq", filters.variant);
  const { data, count, error } = await query.order("created_at", { ascending: false }).order("id").range((page - 1) * size, page * size - 1).returns<Row<T>[]>();
  if (error) throw error;
  // SELECT * is constrained to generated table names; no handwritten row model.
  return { rows: data ?? [], count: count ?? 0 };
}
export async function saveMaster<T extends Editable>(table: T, org: string, id: string | null, values: Database["public"]["Tables"][T]["Update"]) {
  const db = dbClient();
  const result = id
    ? await db.from(table as Editable).update(values as Database["public"]["Tables"][Editable]["Update"]).eq("organization_id", org).eq("id", id).select("id").single()
    : await db.from(table as Editable).insert({ ...values, organization_id: org } as Database["public"]["Tables"][Editable]["Insert"]).select("id").single();
  if (result.error) throw result.error;
  return result.data.id;
}
export async function rpc<N extends keyof Database["public"]["Functions"]>(name: N, args: Database["public"]["Functions"][N]["Args"]) {
  const { data, error } = await dbClient().rpc(name, args);
  if (error) throw error;
  return data as Database["public"]["Functions"][N]["Returns"];
}
export type StockRow = { id: string; sku: string; name: string; product_name: string; unit_code: string; unit_id: string; quantity: number; inventory_value: number; minimum_stock: number; revision: number };
function record(value: Json): Record<string, Json | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Respons database tidak valid.");
  return value;
}
export async function productPage(org: string, search: string, category: string, active: string, page: number): Promise<Page<Row<"products">>> {
  const result = record(await rpc("search_product_ids", { p_organization_id: org, p_search: search, p_category_id: category || null, p_active: active, p_page: page }));
  if (!Array.isArray(result.ids) || !result.ids.every((id): id is string => typeof id === "string") || typeof result.count !== "number") throw new Error("Respons katalog tidak valid");
  if (!result.ids.length) return { rows: [], count: result.count };
  const { data, error } = await dbClient().from("products").select("*").eq("organization_id", org).in("id", result.ids);
  if (error) throw error;
  return { rows: result.ids.flatMap(id => data.filter(row => row.id === id)), count: result.count };
}
export async function stockPage(org: string, outlet: string, location: string | null, search: string, low: boolean, page: number, size = pageSize): Promise<Page<StockRow>> {
  const response = record(await rpc("list_stock", { p_organization_id: org, p_outlet_id: outlet, p_location_id: location, p_search: search, p_low_only: low, p_page: page, p_page_size: size }));
  if (!Array.isArray(response.rows) || typeof response.count !== "number") throw new Error("Respons stok tidak valid.");
  return { count: response.count, rows: response.rows.map(value => {
    const row = record(value);
    const str = (key: string) => { if (typeof row[key] !== "string") throw new Error(`Field ${key} tidak valid`); return row[key]; };
    const num = (key: string) => { if (typeof row[key] !== "number" || !Number.isFinite(row[key])) throw new Error(`Field ${key} tidak valid`); return row[key]; };
    return { id: str("id"), sku: str("sku"), name: str("name"), product_name: str("product_name"), unit_code: str("unit_code"), unit_id: str("unit_id"), quantity: num("quantity"), inventory_value: num("inventory_value"), minimum_stock: num("minimum_stock"), revision: num("revision") };
  }) };
}

// Export all server pages with the same filters. Never silently export only the visible page.
export async function collectPages<T>(fetchPage: (page: number) => Promise<Page<T>>) {
  const rows: T[] = [];
  for (let page = 1; ; page++) {
    const result = await fetchPage(page);
    rows.push(...result.rows);
    if (rows.length >= result.count || !result.rows.length) return rows;
  }
}
export function toCsv(rows: (string | number | null)[][]) {
  return "\ufeff" + rows.map(row => row.map(value => {
    let text = String(value ?? "");
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(",")).join("\r\n");
}
export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
