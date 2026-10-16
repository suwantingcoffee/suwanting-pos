import { useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Ellipsis,
  LoaderCircle,
  Package,
  ShoppingBag,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type TableColumn } from "@/components/ui/data-table";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { useToast } from "@/components/ui/toast";
import { demoOrders, demoRevenue, type DemoOrder } from "@/features/dashboard/demo-data";

type DataState = "ready" | "loading" | "error";
const currency = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const statistics = [
  {
    label: "Total penjualan",
    value: "Rp 8.450.000",
    change: "+12,8%",
    icon: CircleDollarSign,
    positive: true,
    iconClass: "bg-primary-soft text-primary",
  },
  {
    label: "Transaksi hari ini",
    value: "64",
    change: "+8,2%",
    icon: ShoppingBag,
    positive: true,
    iconClass: "bg-success-soft text-success",
  },
  {
    label: "Produk terjual",
    value: "128",
    change: "+4,6%",
    icon: Package,
    positive: true,
    iconClass: "bg-warning-soft text-warning",
  },
  {
    label: "Pelanggan baru",
    value: "18",
    change: "-2,1%",
    icon: UsersRound,
    positive: false,
    iconClass: "bg-elevated text-secondary",
  },
];

function RevenueChart() {
  const points = demoRevenue
    .map((item, index) => `${24 + index * 47},${135 - item.revenue * 1.13}`)
    .join(" ");
  const areaPoints = `24,145 ${points} 306,145`;

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-full bg-primary" />
          Penjualan demo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2 rounded-full bg-chart-muted" />
          Periode 7 hari
        </span>
      </div>
      <svg
        aria-label="Grafik demo penjualan selama tujuh hari"
        className="h-[190px] w-full overflow-visible"
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 324 168"
      >
        {[22, 62, 102, 142].map((y) => (
          <line
            className="chart-grid-line"
            key={y}
            x1="18"
            x2="316"
            y1={y}
            y2={y}
          />
        ))}
        <polygon fill="var(--primary-soft)" opacity=".75" points={areaPoints} />
        <polyline
          fill="none"
          points={points}
          stroke="var(--primary)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        {demoRevenue.map((item, index) => (
          <circle
            cx={24 + index * 47}
            cy={135 - item.revenue * 1.13}
            fill="var(--surface)"
            key={item.day}
            r="4"
            stroke="var(--primary)"
            strokeWidth="2.5"
          />
        ))}
        {demoRevenue.map((item, index) => (
          <text
            className="chart-label"
            key={item.day}
            textAnchor="middle"
            x={24 + index * 47}
            y="163"
          >
            {item.day}
          </text>
        ))}
      </svg>
    </div>
  );
}

function OrdersChart() {
  return (
    <div className="mt-2 flex h-[164px] items-end justify-between gap-2 px-1">
      {demoRevenue.map((item, index) => (
        <div
          className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
          key={item.day}
        >
          <div className="flex h-[132px] w-full max-w-8 items-end gap-1">
            <span
              className="w-1/2 rounded-t-md bg-primary"
              style={{ height: `${item.orders * 1.5}%` }}
            />
            <span
              className="w-1/2 rounded-t-md bg-elevated"
              style={{ height: `${demoRevenue[(index + 3) % demoRevenue.length].orders * 1.25}%` }}
            />
          </div>
          <span className="text-[10px] text-secondary">{item.day}</span>
        </div>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const [dataState, setDataState] = useState<DataState>("ready");
  const [tableState, setTableState] = useState<DataState>("ready");
  const [page, setPage] = useState(1);
  const toast = useToast();
  const currentDate = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
  const itemsPerPage = 4;
  const pageCount = Math.ceil(demoOrders.length / itemsPerPage);
  const visibleOrders = demoOrders.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage,
  );

  const columns: TableColumn<DemoOrder>[] = [
    {
      key: "id",
      header: "ID transaksi",
      render: (order) => <span className="font-medium">{order.id}</span>,
    },
    {
      key: "customer",
      header: "Pelanggan",
      render: (order) => order.customer,
    },
    { key: "date", header: "Waktu", render: (order) => order.date },
    {
      key: "amount",
      header: "Total",
      render: (order) => (
        <span className="font-medium">{currency.format(order.amount)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (order) => (
        <Badge
          variant={
            order.status === "Selesai"
              ? "success"
              : order.status === "Diproses"
                ? "warning"
                : "default"
          }
        >
          {order.status}
        </Badge>
      ),
    },
  ];

  const tableMenu: DropdownItem[] = [
    {
      label: "Tampilkan skeleton",
      onSelect: () => {
        setTableState("loading");
        window.setTimeout(() => setTableState("ready"), 1400);
      },
    },
    { label: "Tampilkan empty state", onSelect: () => setTableState("error") },
    { label: "Kembali ke data demo", onSelect: () => setTableState("ready") },
  ];
  const pageMenu: DropdownItem[] = [
    {
      label: "Simulasikan loading",
      icon: <LoaderCircle aria-hidden="true" size={15} />,
      onSelect: () => {
        setDataState("loading");
        window.setTimeout(() => setDataState("ready"), 1400);
      },
    },
    {
      label: "Simulasikan error",
      icon: <TriangleAlert aria-hidden="true" size={15} />,
      onSelect: () => setDataState("error"),
    },
    {
      label: "Tampilkan dashboard demo",
      onSelect: () => setDataState("ready"),
    },
  ];

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="demo">DEMO · DATA CONTOH</Badge>
            <span className="text-[11px] text-secondary">Workspace presentasi</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Ringkasan toko
          </h1>
          <p className="mt-1 text-xs text-secondary sm:text-sm">
            Pantau ringkasan operasional harian toko Suwanting Coffee.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() =>
              toast({
                title: "Data contoh diperbarui",
                description: "Dashboard ini hanya berisi data presentasi DEMO.",
                variant: "info",
              })
            }
            variant="secondary"
          >
            <span className="hidden sm:inline">Hari ini · </span>
            {currentDate}
          </Button>
          <Dropdown
            items={pageMenu}
            label="Simulasi state dashboard"
            trigger={
              <span className="grid size-10 place-items-center rounded-xl border bg-surface text-secondary hover:bg-elevated">
                <Ellipsis aria-hidden="true" size={19} />
              </span>
            }
          />
        </div>
      </section>

      {dataState === "loading" ? (
        <DashboardSkeleton />
      ) : (
        <>
          {dataState === "error" ? (
            <Card>
              <EmptyState
                action={
                  <Button onClick={() => setDataState("ready")} variant="secondary">
                    Coba lagi
                  </Button>
                }
                description="Tidak ada data untuk ditampilkan. Data produksi belum dihubungkan."
                title="Data belum tersedia"
              />
            </Card>
          ) : (
            <>
              <section
                aria-label="Statistik penjualan demo"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
              >
                {statistics.map((statistic) => {
                  const Icon = statistic.icon;
                  const ChangeIcon = statistic.positive
                    ? ArrowUpRight
                    : ArrowDownRight;
                  return (
                    <Card className="p-4 sm:p-5" key={statistic.label}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs text-secondary">
                            {statistic.label}
                          </p>
                          <p className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
                            {statistic.value}
                          </p>
                        </div>
                        <span
                          className={`grid size-10 shrink-0 place-items-center rounded-xl ${statistic.iconClass}`}
                        >
                          <Icon aria-hidden="true" size={19} />
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center text-[10px] font-medium ${
                            statistic.positive ? "text-success" : "text-danger"
                          }`}
                        >
                          <ChangeIcon aria-hidden="true" size={13} />
                          {statistic.change}
                        </span>
                        <span className="text-[10px] text-secondary">
                          dibanding periode lalu · DEMO
                        </span>
                      </div>
                    </Card>
                  );
                })}
              </section>

              <section className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[1.55fr_1fr]">
                <Card>
                  <CardHeader>
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <CardTitle>Tren penjualan</CardTitle>
                        <Badge variant="demo">DEMO</Badge>
                      </div>
                      <p className="text-[11px] text-secondary">
                        Ilustrasi aktivitas, bukan data transaksi produksi.
                      </p>
                    </div>
                    <Dropdown
                      items={[
                        {
                          label: "7 hari terakhir",
                          onSelect: () => undefined,
                        },
                        { label: "30 hari terakhir", onSelect: () => undefined },
                      ]}
                      label="Rentang waktu grafik"
                      trigger={
                        <span className="grid size-9 place-items-center rounded-lg text-secondary hover:bg-elevated">
                          <Ellipsis aria-hidden="true" size={19} />
                        </span>
                      }
                    />
                  </CardHeader>
                  <RevenueChart />
                </Card>

                <Card>
                  <CardHeader>
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <CardTitle>Aktivitas pesanan</CardTitle>
                        <Badge variant="demo">DEMO</Badge>
                      </div>
                      <p className="text-[11px] text-secondary">
                        Perbandingan ilustratif selama seminggu.
                      </p>
                    </div>
                  </CardHeader>
                  <OrdersChart />
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-secondary">
                    <span className="inline-flex items-center gap-1.5">
                      <i className="size-2 rounded-sm bg-primary" />
                      Pesanan demo
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <i className="size-2 rounded-sm bg-elevated" />
                      Periode pembanding
                    </span>
                  </div>
                </Card>
              </section>

              <Card padded={false}>
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">Transaksi terbaru</h2>
                      <Badge variant="demo">DEMO · TIDAK TERSIMPAN</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-secondary">
                      Contoh tampilan tabel untuk rancangan antarmuka.
                    </p>
                  </div>
                  <Dropdown
                    items={tableMenu}
                    label="Opsi pratinjau tabel"
                    trigger={
                      <span className="grid size-9 place-items-center rounded-lg border text-secondary hover:bg-elevated">
                        <Ellipsis aria-hidden="true" size={18} />
                      </span>
                    }
                  />
                </div>
                {tableState === "loading" ? (
                  <div aria-label="Memuat transaksi demo" className="space-y-3 p-5" role="status">
                    <span className="sr-only">Memuat transaksi demo...</span>
                    <div className="skeleton-shimmer h-9 rounded-xl" />
                    <div className="skeleton-shimmer h-9 rounded-xl" />
                    <div className="skeleton-shimmer h-9 rounded-xl" />
                  </div>
                ) : tableState === "error" ? (
                  <EmptyState
                    action={
                      <Button
                        onClick={() => setTableState("ready")}
                        size="sm"
                        variant="secondary"
                      >
                        Pulihkan pratinjau DEMO
                      </Button>
                    }
                    description="Belum ada transaksi produksi yang dihubungkan ke POS ini."
                    title="Belum ada data transaksi"
                  />
                ) : (
                  <>
                    <DataTable
                      columns={columns}
                      getRowKey={(order) => order.id}
                      rows={visibleOrders}
                    />
                    <div className="p-4 sm:px-5">
                      <Pagination
                        onPageChange={setPage}
                        page={page}
                        pages={pageCount}
                      />
                    </div>
                  </>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
