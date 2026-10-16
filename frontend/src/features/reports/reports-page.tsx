import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyRows, ErrorNotice, Field, LoadingRows, Lookup } from "@/features/operations/shared";
import { useExport, useRemote } from "@/features/operations/hooks";
import { Workspace, type Scope } from "@/features/operations/workspace";
import { dbClient, downloadCsv, money } from "@/lib/catalog-api";
import { analyticsReport, type ReportData } from "./reports-api";

type Options = {
  outlets: { id: string; name: string; archived_at: string | null }[];
};

const reportRoles = ["owner", "admin", "manager", "finance_staff"];
const paymentMethods = [
  ["", "Semua metode"], ["cash", "Tunai"], ["transfer", "Transfer"],
  ["qris", "QRIS"], ["card", "Kartu"], ["bank", "Bank"], ["ewallet", "Akun pembayaran"],
];

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthStart() {
  const date = new Date();
  date.setDate(1);
  return localDate(date);
}

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localDate(date);
}

export function DashboardPage() {
  return <AnalyticsWorkspace dashboard />;
}

export function ReportsPage() {
  return <AnalyticsWorkspace dashboard={false} />;
}

function AnalyticsWorkspace({ dashboard }: { dashboard: boolean }) {
  return (
    <Workspace
      title={dashboard ? "Dashboard" : "Laporan"}
      description={dashboard
        ? "Performa penjualan, laba, stok, kasir, dan pembayaran dari transaksi Supabase."
        : "Laporan penjualan, margin, laba rugi, arus kas, persediaan, rekonsiliasi, dan kasir."}
    >
      {(scope) => <Analytics scope={scope} dashboard={dashboard} />}
    </Workspace>
  );
}

function Analytics({ scope, dashboard }: { scope: Scope; dashboard: boolean }) {
  const [from, setFrom] = useState(monthStart);
  const [until, setUntil] = useState(tomorrow);
  const [outlet, setOutlet] = useState("");
  const [product, setProduct] = useState("");
  const [category, setCategory] = useState("");
  const [method, setMethod] = useState("");
  const [grain, setGrain] = useState<"day" | "week" | "month">("day");
  const [tab, setTab] = useState("sales");
  const csvExport = useExport();
  const canRead = reportRoles.includes(scope.role);
  const options = useRemote(useCallback(async () => {
    if (!canRead) return null;
    const db = dbClient();
    const { data, error } = await db.from("outlets").select("id,name,archived_at").eq("organization_id", scope.org).order("name");
    if (error) throw error;
    return { outlets: data ?? [] } satisfies Options;
  }, [canRead, scope.org]));
  const selectedOutlets = useMemo(
    () => outlet === "all" ? options.data?.outlets.map((item) => item.id) ?? [] : outlet ? [outlet] : [],
    [outlet, options.data],
  );
  const filters = useMemo(() => ({
    organization: scope.org, from, until, outlets: selectedOutlets,
    product, category, paymentMethod: method, grain,
  }), [scope.org, from, until, selectedOutlets, product, category, method, grain]);
  const result = useRemote(useCallback(async () => {
    if (!canRead || !options.data) return null;
    if (!from || !until || until <= from) throw new Error("Rentang tanggal tidak valid.");
    if (!options.data.outlets.length) return null;
    return analyticsReport(filters);
  }, [canRead, options.data, from, until, filters]));

  if (!canRead) return <Card><p className="text-sm">Dashboard dan laporan keuangan hanya tersedia untuk owner, admin, manager, dan finance_staff.</p></Card>;
  if (options.loading) return <Card><LoadingRows /></Card>;
  if (options.error) return <Card><ErrorNotice error={options.error} retry={options.refresh} /></Card>;
  if (!options.data) return <Card><p className="text-sm">Belum ada outlet yang dapat dilaporkan.</p></Card>;
  if (!options.data.outlets.length) return <Card><EmptyRows /></Card>;
  const data = result.data;

  return (
    <div className="space-y-4">
      <Card className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6 xl:items-end">
        <Field label="Dari tanggal"><Input type="date" value={from} max={until} onChange={(event) => setFrom(event.target.value)} /></Field>
        <Field label="Sampai (eksklusif)"><Input type="date" value={until} min={from} onChange={(event) => setUntil(event.target.value)} /></Field>
        <Field label="Outlet"><Select value={outlet || "all"} onChange={(event) => setOutlet(event.target.value)}><option value="all">Semua outlet terotorisasi</option>{options.data.outlets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
        <Field label="Produk / varian"><Lookup table="product_variants" org={scope.org} value={product} onChange={setProduct} placeholder="Semua produk" searchColumn="name" includeArchived /></Field>
        <Field label="Kategori produk"><Lookup table="categories" org={scope.org} value={category} onChange={setCategory} placeholder="Semua kategori" includeArchived /></Field>
        <Field label="Metode pembayaran"><Select value={method} onChange={(event) => setMethod(event.target.value)}>{paymentMethods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
      </Card>
      {result.loading ? <Card><LoadingRows /></Card> : result.error ? <Card><ErrorNotice error={result.error} retry={result.refresh} /></Card> : !data ? <Card><EmptyRows /></Card> : <>
        {dashboard
          ? <Dashboard data={data} grain={grain} setGrain={setGrain} refresh={result.refresh} />
          : <Reports data={data} tab={tab} setTab={setTab} grain={grain} setGrain={setGrain} />}
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-secondary">CSV mengikuti filter dan scope yang sudah diterapkan server.</p>
          <div className="flex flex-wrap gap-2">
            {!dashboard && tab === "products" && <Button disabled={csvExport.busy} variant="secondary" onClick={() => void csvExport.run(async () => exportCategories(data))}><Download size={15} />Ekspor kategori</Button>}
            {!dashboard && tab === "profit" && <Button disabled={csvExport.busy} variant="secondary" onClick={() => void csvExport.run(async () => exportExpenses(data))}><Download size={15} />Ekspor beban</Button>}
            <Button disabled={csvExport.busy} variant="secondary" onClick={() => void csvExport.run(async () => exportReport(data, dashboard ? "sales" : tab))}><Download size={15} />{csvExport.busy ? "Mengekspor…" : `Ekspor CSV ${dashboard ? "ringkasan" : tab}`}</Button>
          </div>
        </Card>
      </>}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <Card><p className="text-xs text-secondary">{label}</p><p className="mt-2 text-lg font-semibold">{value}</p>{detail && <p className="mt-1 text-xs text-secondary">{detail}</p>}</Card>;
}

function Dashboard({ data, grain, setGrain, refresh }: { data: ReportData; grain: "day" | "week" | "month"; setGrain: (value: "day" | "week" | "month") => void; refresh: () => void }) {
  return <div className="space-y-4">
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div><Badge variant="success">DATA SUPABASE</Badge><p className="mt-2 text-xs text-secondary">Hanya transaksi selesai/lunas dihitung sebagai penjualan. Pembayaran tertunda tidak menjadi omzet atau kas masuk.</p></div>
      <div className="flex gap-2"><Select aria-label="Agregasi grafik" value={grain} onChange={(event) => setGrain(event.target.value as "day" | "week" | "month")}><option value="day">Harian</option><option value="week">Mingguan</option><option value="month">Bulanan</option></Select><Button size="sm" variant="secondary" onClick={refresh}><RefreshCw size={15} />Muat ulang</Button></div>
    </Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Omzet kotor" value={money(data.sales.gross_sales)} detail={`Diskon ${money(data.sales.discounts)}`} />
      <Metric label="Penjualan bersih" value={money(data.sales.net_sales)} detail="Diskon dan refund sebelum pajak dikurangkan." />
      <Metric label="Jumlah transaksi" value={data.sales.transactions.toLocaleString("id-ID")} />
      <Metric label="Rata-rata transaksi" value={money(data.sales.average_transaction)} />
      <Metric label="Harga pokok penjualan" value={money(data.sales.cogs)} detail="Dari snapshot biaya saat order difinalisasi." />
      <Metric label="Laba kotor" value={money(data.sales.gross_profit)} detail="Penjualan bersih dikurangi HPP." />
      <Metric label="Pengeluaran operasional" value={money(data.profit_loss.operating_expenses)} />
      <Metric label="Laba bersih tercatat" value={money(data.profit_loss.net_profit)} detail="Laba kotor + pemasukan lain − beban tercatat." />
    </div>
    <SalesChart data={data} grain={grain} />
    <div className="grid gap-4 xl:grid-cols-2">
      <ProductTable data={data} title="Produk terlaris" limit={8} />
      <StockTable data={data} limit={8} />
      <OutletTable data={data} />
      <PaymentTable data={data} />
      <RecentTable data={data} />
      <ProfitNote data={data} />
    </div>
  </div>;
}

function SalesChart({ data, grain }: { data: ReportData; grain: "day" | "week" | "month" }) {
  const max = Math.max(1, ...data.series.map((item) => item.net_sales));
  return <Card><h2 className="font-semibold">Penjualan {grain === "day" ? "harian" : grain === "week" ? "mingguan" : "bulanan"}</h2>
    {data.series.length === 0 || data.series.every((item) => item.transactions === 0) ? <EmptyRows /> : <div className="mt-4 grid max-h-72 grid-flow-col auto-cols-[minmax(3.25rem,1fr)] items-end gap-2 overflow-x-auto border-b pb-2">
      {data.series.map((item) => <div className="flex h-52 min-w-0 flex-col justify-end gap-1 text-center" key={item.period} title={`${item.period}: ${money(item.net_sales)}`}>
        <span className="truncate text-[10px] text-secondary">{item.transactions ? item.transactions : ""}</span>
        <div className="mx-auto w-full max-w-8 rounded-t bg-primary" style={{ height: `${Math.max(item.net_sales ? 3 : 0, item.net_sales / max * 100)}%` }} />
        <span className="truncate text-[10px] text-secondary">{item.period.slice(5, 10)}</span>
      </div>)}
    </div>}</Card>;
}

function ProductTable({ data, title, limit = 100 }: { data: ReportData; title: string; limit?: number }) {
  const rows = data.products.slice(0, limit);
  return <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">{title}</h2></div>
    {rows.length ? <DataTable rows={rows} getRowKey={(row) => row.variant_id} columns={[
      { key: "product", header: "Produk / varian", render: (row) => <div><p>{row.product_label} · {row.variant ?? ""}</p><p className="text-xs text-secondary">{row.sku ?? ""} · {row.category_label}</p></div> },
      { key: "qty", header: "Terjual", render: (row) => row.quantity.toLocaleString("id-ID") },
      { key: "net", header: "Bersih", render: (row) => money(row.net_sales) },
      { key: "margin", header: "Margin kotor", render: (row) => `${row.margin_percent.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%` },
    ]} /> : <EmptyRows />}</Card>;
}

function StockTable({ data, limit = 100 }: { data: ReportData; limit?: number }) {
  const rows = data.low_stock.slice(0, limit);
  return <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">Stok menipis</h2><p className="mt-1 text-xs text-secondary">Stok aktual dibanding minimum pada ledger stok.</p></div>
    {rows.length ? <DataTable rows={rows} getRowKey={(row) => row.variant_id} columns={[
      { key: "name", header: "Produk", render: (row) => `${row.product} · ${row.variant} (${row.sku})` },
      { key: "quantity", header: "Tersedia", render: (row) => row.quantity.toLocaleString("id-ID") },
      { key: "minimum", header: "Minimum", render: (row) => row.minimum_stock.toLocaleString("id-ID") },
    ]} /> : <EmptyRows />}</Card>;
}

function OutletTable({ data }: { data: ReportData }) {
  return <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">Performa outlet</h2></div>
    {data.outlets.length ? <DataTable rows={data.outlets} getRowKey={(row) => row.outlet_id} columns={[
      { key: "outlet", header: "Outlet", render: (row) => row.outlet_name },
      { key: "count", header: "Transaksi", render: (row) => row.transactions.toLocaleString("id-ID") },
      { key: "sales", header: "Bersih", render: (row) => money(row.net_sales) },
      { key: "profit", header: "Kotor", render: (row) => money(row.gross_profit) },
    ]} /> : <EmptyRows />}</Card>;
}

function PaymentTable({ data }: { data: ReportData }) {
  return <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">Metode pembayaran</h2><p className="mt-1 text-xs text-secondary">Jumlah ini adalah penerimaan tercatat, bukan nilai order split secara penuh.</p></div>
    {data.payment_methods.length ? <DataTable rows={data.payment_methods} getRowKey={(row) => row.method} columns={[
      { key: "method", header: "Metode", render: (row) => row.method },
      { key: "transactions", header: "Transaksi", render: (row) => row.transactions.toLocaleString("id-ID") },
      { key: "received", header: "Diterima", render: (row) => money(row.received) },
    ]} /> : <EmptyRows />}</Card>;
}

function RecentTable({ data }: { data: ReportData }) {
  return <Card padded={false} className="xl:col-span-2"><div className="border-b p-4"><h2 className="font-semibold">Transaksi terbaru</h2></div>
    {data.recent_transactions.length ? <DataTable rows={data.recent_transactions} getRowKey={(row) => row.id} columns={[
      { key: "receipt", header: "Struk", render: (row) => row.receipt_number ?? row.id },
      { key: "time", header: "Waktu", render: (row) => new Date(row.finalized_at).toLocaleString("id-ID") },
      { key: "outlet", header: "Outlet", render: (row) => row.outlet_name },
      { key: "cashier", header: "Kasir", render: (row) => row.cashier_name },
      { key: "status", header: "Pembayaran", render: (row) => row.payment_status },
      { key: "total", header: "Total", render: (row) => money(row.total) },
    ]} /> : <EmptyRows />}</Card>;
}

function ProfitNote({ data }: { data: ReportData }) {
  return <Card><h2 className="font-semibold">Definisi laba bersih</h2><p className="mt-2 text-sm text-secondary">Laba kotor + pemasukan lain − pengeluaran operasional − bunga dan biaya pinjaman − waste tercatat − selisih kas kurang.</p>
    <p className="mt-2 text-xs text-secondary">Pokok pinjaman, modal, pembelian aset, dan pajak penjualan tidak dianggap beban. Belum termasuk depresiasi, pajak penghasilan, beban akrual, atau penyusutan persediaan lama tanpa snapshot HPP.</p>
    <div className="mt-4 flex justify-between border-t pt-3 text-sm"><span>Laba bersih (basis transaksi tercatat)</span><strong>{money(data.profit_loss.net_profit)}</strong></div></Card>;
}

function Reports({ data, tab, setTab, grain, setGrain }: { data: ReportData; tab: string; setTab: (value: string) => void; grain: "day" | "week" | "month"; setGrain: (value: "day" | "week" | "month") => void }) {
  const tabs = [
    ["sales", "Penjualan"], ["products", "Produk & kategori"], ["profit", "Margin & laba rugi"],
    ["cash", "Cashflow & akun"], ["inventory", "Stok, waste & produksi"],
    ["payments", "Pembayaran"], ["cashiers", "Kasir"],
  ];
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">{tabs.map(([key, label]) => <Button key={key} variant={tab === key ? "primary" : "secondary"} onClick={() => setTab(key)}>{label}</Button>)}</div>
    {tab === "sales" && <div className="space-y-4"><Card className="flex items-center gap-3"><Field label="Kelompok periode"><Select value={grain} onChange={(event) => setGrain(event.target.value as "day" | "week" | "month")}><option value="day">Harian</option><option value="week">Mingguan</option><option value="month">Bulanan</option></Select></Field></Card><SalesChart data={data} grain={grain} /><RecentTable data={data} /></div>}
    {tab === "products" && <div className="space-y-4"><ProductTable data={data} title="Penjualan, HPP, dan margin per produk" /><Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">Penjualan per kategori</h2></div>{data.categories.length ? <DataTable rows={data.categories} getRowKey={(row) => row.category_id ?? "uncategorized"} columns={[
      { key: "category", header: "Kategori", render: (row) => row.category_label }, { key: "quantity", header: "Terjual", render: (row) => row.quantity.toLocaleString("id-ID") },
      { key: "net", header: "Penjualan bersih", render: (row) => money(row.net_sales) }, { key: "cogs", header: "HPP", render: (row) => money(row.cogs) },
      { key: "profit", header: "Laba kotor", render: (row) => money(row.gross_profit) },
    ]} /> : <EmptyRows />}</Card></div>}
    {tab === "profit" && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Omzet kotor" value={money(data.sales.gross_sales)} /><Metric label="Diskon" value={money(data.sales.discounts)} />
      <Metric label="Refund bruto" value={money(data.sales.refunds)} detail={`Termasuk pajak ${money(data.sales.refund_tax)}`} />
      <Metric label="Pajak penjualan" value={money(data.sales.sales_tax)} detail="Liabilitas, bukan pendapatan." />
      <Metric label="HPP" value={money(data.profit_loss.cogs)} /><Metric label="Laba kotor" value={money(data.profit_loss.gross_profit)} />
      <Metric label="Pemasukan lain" value={money(data.profit_loss.other_income)} /><Metric label="Beban operasional" value={money(data.profit_loss.operating_expenses)} />
      <Metric label="Bunga + biaya pinjaman" value={money(data.profit_loss.interest_expense + data.profit_loss.loan_fees)} />
      <Metric label="Kerugian waste" value={money(data.profit_loss.waste_cost)} /><Metric label="Selisih kas kurang" value={money(data.profit_loss.cash_shortage)} />
      <Metric label="Laba bersih tercatat" value={money(data.profit_loss.net_profit)} />
      <ProfitNote data={data} />
      <Card padded={false} className="sm:col-span-2 xl:col-span-4"><div className="border-b p-4"><h2 className="font-semibold">Beban operasional</h2></div>{data.expenses.length ? <DataTable rows={data.expenses} getRowKey={(row) => row.id} columns={[
        { key: "date", header: "Tanggal", render: (row) => row.incurred_on }, { key: "category", header: "Kategori", render: (row) => row.category ?? "—" },
        { key: "description", header: "Keterangan", render: (row) => row.description }, { key: "account", header: "Akun", render: (row) => row.account ?? "—" },
        { key: "amount", header: "Jumlah", render: (row) => money(row.amount) },
      ]} /> : <EmptyRows />}</Card>
    </div>}
    {tab === "cash" && <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Metric label="Kas masuk" value={money(data.cashflow.cash_in)} /><Metric label="Kas keluar" value={money(data.cashflow.cash_out)} /><Metric label="Arus kas bersih" value={money(data.cashflow.net_cashflow)} /></div>
      <ReportTable title="Saldo akun pembayaran (s.d. tanggal akhir)" rows={data.account_balances} columns={[
        { key: "name", header: "Akun", render: (row) => row.name }, { key: "kind", header: "Jenis", render: (row) => row.kind },
        { key: "balance", header: "Saldo", render: (row) => money(row.balance) },
      ]} keyOf={(row) => row.id} />
      <ReportTable title="Mutasi kas" rows={data.cash_movements} columns={[
        { key: "date", header: "Tanggal", render: (row) => new Date(row.date).toLocaleString("id-ID") },
        { key: "account", header: "Akun", render: (row) => row.account }, { key: "reason", header: "Jenis", render: (row) => row.reason.replaceAll("_", " ") },
        { key: "amount", header: "Jumlah", render: (row) => money(row.amount) },
      ]} keyOf={(row) => `${row.date}:${row.account_id}:${row.reference_id ?? row.reason}`} />
    </div>}
    {tab === "inventory" && <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Metric label="Kuantitas stok" value={data.inventory.quantity.toLocaleString("id-ID")} /><Metric label="Valuasi persediaan" value={money(data.inventory.valuation)} /></div>
      <StockTable data={data} />
      <ReportTable title="Mutasi stok" rows={data.inventory_movements} columns={[
        { key: "date", header: "Tanggal", render: (row) => new Date(row.created_at).toLocaleString("id-ID") },
        { key: "product", header: "Produk", render: (row) => `${row.product} · ${row.sku}` }, { key: "reason", header: "Jenis", render: (row) => row.reason.replaceAll("_", " ") },
        { key: "qty", header: "Jumlah", render: (row) => row.quantity.toLocaleString("id-ID") }, { key: "note", header: "Catatan", render: (row) => row.note },
      ]} keyOf={(row) => row.id} />
      <ReportTable title="Waste" rows={data.waste} columns={[
        { key: "date", header: "Tanggal", render: (row) => new Date(row.created_at).toLocaleString("id-ID") },
        { key: "product", header: "Produk", render: (row) => `${row.product} · ${row.variant}` },
        { key: "quantity", header: "Jumlah", render: (row) => row.quantity.toLocaleString("id-ID") }, { key: "reason", header: "Alasan", render: (row) => row.reason },
      ]} keyOf={(row) => row.id} />
      <ReportTable title="Produksi" rows={data.production} columns={[
        { key: "date", header: "Tanggal", render: (row) => new Date(row.produced_at).toLocaleString("id-ID") },
        { key: "kind", header: "Jenis", render: (row) => row.batch_kind }, { key: "input", header: "Input", render: (row) => row.input_quantity.toLocaleString("id-ID") },
        { key: "output", header: "Output", render: (row) => row.output_quantity.toLocaleString("id-ID") }, { key: "cost", header: "Nilai hasil", render: (row) => money(row.output_cost) },
      ]} keyOf={(row) => row.id} />
    </div>}
    {tab === "payments" && <div className="space-y-4"><PaymentTable data={data} /><ReportTable title="Rekonsiliasi pembayaran" rows={data.payment_reconciliation} columns={[
      { key: "method", header: "Metode", render: (row) => row.method }, { key: "status", header: "Status", render: (row) => row.status },
      { key: "attempts", header: "Percobaan", render: (row) => row.attempts.toLocaleString("id-ID") }, { key: "amount", header: "Nilai", render: (row) => money(row.amount) },
    ]} keyOf={(row) => `${row.method}:${row.status}`} /></div>}
    {tab === "cashiers" && <ReportTable title="Kinerja kasir" rows={data.cashiers} columns={[
      { key: "name", header: "Kasir", render: (row) => row.cashier_name }, { key: "count", header: "Transaksi", render: (row) => row.transactions.toLocaleString("id-ID") },
      { key: "sales", header: "Nilai order", render: (row) => money(row.total_sales) }, { key: "avg", header: "Rata-rata", render: (row) => money(row.average_transaction) },
      { key: "cogs", header: "HPP", render: (row) => money(row.cogs) },
    ]} keyOf={(row) => row.cashier_id} />}
  </div>;
}

function ReportTable<T>({ title, rows, columns, keyOf }: { title: string; rows: T[]; columns: { key: string; header: string; render: (row: T) => ReactNode }[]; keyOf: (row: T) => string }) {
  return <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">{title}</h2></div>{rows.length ? <DataTable rows={rows} getRowKey={keyOf} columns={columns} /> : <EmptyRows />}</Card>;
}

function exportReport(data: ReportData, tab: string) {
  if (tab === "products") {
    downloadCsv("suwanting-produk.csv", [
      ["SKU", "Varian", "Produk", "Kategori", "Terjual", "Penjualan bersih IDR", "HPP IDR", "Laba kotor IDR", "Margin %"],
      ...data.products.map((row) => [row.sku, row.variant, row.product_label, row.category_label, row.quantity, row.net_sales, row.cogs, row.gross_profit, row.margin_percent]),
    ]);
  } else if (tab === "profit") {
    downloadCsv("suwanting-laba-rugi.csv", [
      ["Metrik", "Jumlah IDR"],
      ...Object.entries(data.profit_loss).map(([key, value]) => [key, value]),
    ]);
  } else if (tab === "cash") {
    downloadCsv("suwanting-cashflow-akun.csv", [
      ["Bagian", "Tanggal", "Akun", "Jenis", "Jumlah IDR", "Referensi"],
      ...[
        ["Arus kas", "", "", "Kas masuk", data.cashflow.cash_in, ""],
        ["Arus kas", "", "", "Kas keluar", data.cashflow.cash_out, ""],
        ["Arus kas", "", "", "Arus kas bersih", data.cashflow.net_cashflow, ""],
        ...data.account_balances.map((row) => ["Saldo akun", "", row.name, row.kind, row.balance, row.id]),
        ...data.cash_movements.map((row) => ["Mutasi kas", row.date, row.account, row.reason, row.amount, row.reference_id]),
      ],
    ]);
  } else if (tab === "inventory") {
    downloadCsv("suwanting-inventori.csv", [
      ["Bagian", "Tanggal", "SKU", "Produk", "Varian / jenis", "Jumlah", "Nilai IDR", "Catatan"],
      ...[
        ...data.inventory.items.map((row) => ["Saldo saat ini", "", row.sku, row.product, row.variant, row.quantity, row.inventory_value, `Minimum: ${row.minimum_stock}`]),
        ...data.inventory_movements.map((row) => ["Mutasi", row.created_at, row.sku, row.product, row.reason, row.quantity, null, row.note]),
        ...data.waste.map((row) => ["Waste", row.created_at, row.sku, row.product, row.variant, row.quantity, null, row.reason]),
        ...data.production.map((row) => ["Produksi", row.produced_at, "", "", row.batch_kind, row.output_quantity, row.output_cost, `Input: ${row.input_quantity}`]),
      ],
    ]);
  } else if (tab === "payments") {
    downloadCsv("suwanting-pembayaran.csv", [
      ["Bagian", "Metode", "Status", "Transaksi / percobaan", "Jumlah IDR"],
      ...[
        ...data.payment_methods.map((row) => ["Penerimaan", row.method, "", row.transactions, row.received]),
        ...data.payment_reconciliation.map((row) => ["Rekonsiliasi", row.method, row.status, row.attempts, row.amount]),
      ],
    ]);
  } else if (tab === "cashiers") {
    downloadCsv("suwanting-kinerja-kasir.csv", [
      ["Kasir", "Transaksi", "Nilai order IDR", "Rata-rata IDR", "HPP IDR"],
      ...data.cashiers.map((row) => [row.cashier_name, row.transactions, row.total_sales, row.average_transaction, row.cogs]),
    ]);
  } else {
    downloadCsv("suwanting-penjualan.csv", [
      ["Bagian", "Tanggal / periode", "Struk", "Outlet", "Kasir", "Status", "Omzet kotor IDR", "Penjualan bersih IDR", "Transaksi / total IDR"],
      ...[
        ...data.series.map((row) => ["Periode", row.period, "", "", "", "", row.gross_sales, row.net_sales, row.transactions]),
        ...data.recent_transactions.map((row) => ["Transaksi", row.finalized_at, row.receipt_number, row.outlet_name, row.cashier_name, row.payment_status, null, null, row.total]),
      ],
    ]);
  }
}

function exportCategories(data: ReportData) {
  downloadCsv("suwanting-kategori.csv", [
    ["Kategori", "Terjual", "Penjualan kotor IDR", "Diskon IDR", "Penjualan bersih IDR", "HPP IDR", "Laba kotor IDR"],
    ...data.categories.map((row) => [row.category_label, row.quantity, row.gross_sales, row.discounts, row.net_sales, row.cogs, row.gross_profit]),
  ]);
}

function exportExpenses(data: ReportData) {
  downloadCsv("suwanting-beban.csv", [
    ["Tanggal", "Kategori", "Keterangan", "Akun", "Jumlah IDR"],
    ...data.expenses.map((row) => [row.incurred_on, row.category, row.description, row.account, row.amount]),
  ]);
}
