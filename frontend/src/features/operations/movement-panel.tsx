import { useDebounced, useExport, useRemote } from "./hooks";
import { useCallback, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { amount, collectPages, downloadCsv, money, readPage } from "@/lib/catalog-api";
import { EmptyRows, ErrorNotice, Field, LoadingRows, Lookup, PageFooter } from "./shared";
import type { Scope } from "./workspace";
export function ReferenceName({ table, id, org }: { table: "product_variants" | "storage_locations" | "recipes" | "suppliers"; id: string | null; org: string }) {
  const result = useRemote(useCallback(async () => id ? (await readPage(table, org, 1, { parent: ["id", id] })).rows[0]?.name ?? id : "Utama / histori lama", [table, id, org]));
  return <span title={id ?? ""}>{result.data ?? (result.loading ? "…" : "Gagal memuat nama")}</span>;
}
export function MovementPanel({ scope }: { scope: Scope }) {
  const [page, setPage] = useState(1); const [variant, setVariant] = useState(""); const [location, setLocation] = useState(""); const [reason, setReason] = useState(""); const [search, setSearch] = useState(""); const term = useDebounced(search); const csv = useExport();
  const fetchPage = useCallback((p: number) => readPage("inventory_movements", scope.org, p, { outlet: scope.outlet, variant: variant || undefined, parent: location ? ["storage_location_id", location] : undefined, reason: reason || undefined, search: term, searchColumn: "note" }), [scope.org, scope.outlet, variant, location, reason, term]);
  const result = useRemote(useCallback(() => fetchPage(page), [fetchPage, page]));
  return <div className="space-y-4"><Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="Varian"><Lookup table="product_variants" org={scope.org} value={variant} onChange={v => { setVariant(v); setPage(1); }} placeholder="semua varian" /></Field><Field label="Lokasi"><Lookup table="storage_locations" org={scope.org} outlet={scope.outlet} value={location} onChange={v => { setLocation(v); setPage(1); }} placeholder="semua lokasi" /></Field><Field label="Jenis"><Select value={reason} onChange={e => { setReason(e.target.value); setPage(1); }}><option value="">Semua jenis</option>{["incoming", "outgoing", "adjustment", "stocktake", "transfer_in", "transfer_out", "receipt", "sale", "production_input", "production_output", "waste"].map(r => <option key={r}>{r}</option>)}</Select></Field><Field label="Catatan"><Input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Cari catatan…" /></Field><Button disabled={csv.busy} variant="secondary" onClick={() => void csv.run(async () => { const rows = await collectPages(fetchPage); downloadCsv("mutasi.csv", [["Waktu", "Varian ID", "Lokasi ID", "Jenis", "Jumlah", "Biaya satuan", "Nilai", "Saldo akhir", "Catatan", "Referensi"], ...rows.map(r => [r.created_at, r.variant_id, r.storage_location_id, r.reason, r.quantity, r.unit_cost, r.total_cost, r.location_balance_after, r.note, r.reference_id])]); })}><Download size={16} />{csv.busy ? "Mengekspor…" : "Ekspor CSV"}</Button></Card>
    <Card padded={false}>{result.loading ? <LoadingRows /> : result.error ? <ErrorNotice error={result.error} retry={result.refresh} /> : <><DataTable rows={result.data?.rows ?? []} getRowKey={r => r.id} columns={[
      { key: "time", header: "Waktu", render: r => new Date(r.created_at).toLocaleString("id-ID") },{ key: "variant", header: "Varian / lokasi", render: r => <div><ReferenceName table="product_variants" id={r.variant_id} org={scope.org} /><p className="mt-1 text-secondary"><ReferenceName table="storage_locations" id={r.storage_location_id} org={scope.org} /></p></div> },{ key: "reason", header: "Jenis", render: r => <div>{r.reason}<p className="mt-1 max-w-xs text-secondary">{r.note}</p></div> },{ key: "qty", header: "Jumlah / saldo lokasi", render: r => <span className={r.quantity < 0 ? "text-danger" : "text-success"}>{r.quantity > 0 ? "+" : ""}{amount(r.quantity)} / {r.location_balance_after === null ? "—" : amount(r.location_balance_after)}</span> },{ key: "cost", header: "Nilai historis", render: r => r.total_cost === null ? "Histori lama" : money(r.total_cost) },
    ]} />{!result.data?.rows.length && <EmptyRows />}<PageFooter result={result.data} page={page} onChange={setPage} /></>}</Card>
  </div>;
}
