import { useState } from "react";
import { Check, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type TableColumn } from "@/components/ui/data-table";
import { Dropdown } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

type DemoProduct = {
  name: string;
  category: string;
  status: "Aktif" | "Draft";
};

const demoProducts: DemoProduct[] = [
  { name: "Merapi Natural", category: "Natural", status: "Aktif" },
  { name: "Merbabu Natural", category: "Natural", status: "Aktif" },
  { name: "Signature Blend", category: "Blend", status: "Draft" },
  { name: "Merapi Washed", category: "Washed", status: "Aktif" },
];

export function UIComponentsPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [page, setPage] = useState(1);
  const toast = useToast();

  const columns: TableColumn<DemoProduct>[] = [
    {
      key: "name",
      header: "Nama produk",
      render: (product) => <span className="font-medium">{product.name}</span>,
    },
    { key: "category", header: "Kategori", render: (product) => product.category },
    {
      key: "status",
      header: "Status",
      render: (product) => (
        <Badge variant={product.status === "Aktif" ? "success" : "default"}>
          {product.status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Aksi",
      render: () => (
        <div className="flex gap-1">
          <Button aria-label="Ubah produk demo" size="icon" variant="ghost">
            <Pencil aria-hidden="true" size={15} />
          </Button>
          <Button
            aria-label="Hapus produk demo"
            onClick={() => setConfirmOpen(true)}
            size="icon"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" size={15} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="demo">UI KIT · DEMO</Badge>
          <span className="text-[11px] text-secondary">
            Komponen antarmuka, bukan modul data produksi.
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Komponen UI
        </h1>
        <p className="mt-1 text-sm text-secondary">
          Pratinjau komponen dasar Suwanting POS dalam tema aktif.
        </p>
      </div>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Button & badge</CardTitle>
              <p className="mt-1 text-xs text-secondary">
                Variasi aksi dan status.
              </p>
            </div>
            <Badge variant="demo">DEMO</Badge>
          </CardHeader>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => toast({ title: "Aksi demo", variant: "success" })}>
              <Check aria-hidden="true" size={16} />
              Primary
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="success">Berhasil</Badge>
            <Badge variant="warning">Menunggu</Badge>
            <Badge variant="danger">Perhatian</Badge>
            <Badge variant="demo">DEMO</Badge>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Input & select</CardTitle>
              <p className="mt-1 text-xs text-secondary">
                Contoh field aksesibel.
              </p>
            </div>
          </CardHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium">
              Pencarian contoh
              <Input placeholder="Cari item..." type="search" />
            </label>
            <label className="space-y-1.5 text-xs font-medium">
              Kategori
              <Select defaultValue="all">
                <option value="all">Semua kategori</option>
                <option value="coffee">Kopi</option>
                <option value="equipment">Peralatan</option>
              </Select>
            </label>
          </div>
        </Card>
      </section>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Table & pagination</CardTitle>
              <Badge variant="demo">DATA DEMO</Badge>
            </div>
            <p className="mt-1 text-[11px] text-secondary">
              Baris contoh hanya untuk pemeriksaan layout.
            </p>
          </div>
          <Dropdown
            items={[
              { label: "Tindakan demo", onSelect: () => toast({ title: "Menu dropdown aktif", variant: "info" }) },
              { label: "Tampilkan empty state", onSelect: () => setEmpty(true) },
            ]}
            label="Aksi tabel demo"
            trigger={
              <span className="grid size-9 place-items-center rounded-xl border text-secondary hover:bg-elevated">
                <MoreHorizontal aria-hidden="true" size={18} />
              </span>
            }
          />
        </div>
        {loading ? (
          <div aria-label="Memuat tabel demo" className="space-y-3 p-5" role="status">
            <span className="sr-only">Memuat tabel demo...</span>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-3/4" />
          </div>
        ) : empty ? (
          <EmptyState
            action={
              <Button
                onClick={() => setEmpty(false)}
                size="sm"
                variant="secondary"
              >
                Tampilkan data demo
              </Button>
            }
            description="Tampilan saat filter tidak menghasilkan item."
            title="Tidak ada hasil"
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              getRowKey={(product) => product.name}
              rows={demoProducts.slice((page - 1) * 2, page * 2)}
            />
            <div className="p-4 sm:px-5">
              <Pagination onPageChange={setPage} page={page} pages={2} />
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2 border-t p-4 sm:px-5">
          <Button
            onClick={() => {
              setLoading(true);
              window.setTimeout(() => setLoading(false), 1000);
            }}
            size="sm"
            variant="secondary"
          >
            Tampilkan skeleton
          </Button>
          <Button
            onClick={() => setLoading(false)}
            size="sm"
            variant="ghost"
          >
            Tampilkan data
          </Button>
        </div>
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dropdown, modal & dialog</CardTitle>
          </CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown
              items={[
                {
                  label: "Pilihan dropdown",
                  icon: <Check aria-hidden="true" size={15} />,
                  onSelect: () => toast({ title: "Dropdown dipilih", variant: "success" }),
                },
              ]}
              label="Buka dropdown contoh"
              trigger={<Button variant="secondary">Dropdown menu</Button>}
            />
            <Button onClick={() => setModalOpen(true)} variant="outline">
              Buka modal
            </Button>
            <Button onClick={() => setConfirmOpen(true)} variant="danger">
              Confirmation dialog
            </Button>
          </div>
          <Modal
            description="Dialog ini tidak menyimpan atau mengubah data."
            footer={
              <Button onClick={() => setModalOpen(false)} variant="secondary">
                Tutup
              </Button>
            }
            onOpenChange={setModalOpen}
            open={modalOpen}
            title="Modal pratinjau"
          >
            <p className="text-sm leading-6 text-secondary">
              Komponen dialog mendukung fokus modal native, tombol Escape, dan
              klik di luar untuk menutup.
            </p>
          </Modal>
          <ConfirmDialog
            confirmLabel="Ya, mengerti"
            message="Dialog konfirmasi ini hanya demonstrasi. Tidak ada produk yang dihapus."
            onConfirm={() =>
              toast({ title: "Konfirmasi demo diterima", variant: "success" })
            }
            onOpenChange={setConfirmOpen}
            open={confirmOpen}
            title="Konfirmasi tindakan"
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Toast & empty state</CardTitle>
          </CardHeader>
          <div className="mb-2 flex flex-wrap gap-2">
            <Button
              onClick={() =>
                toast({
                  title: "Berhasil",
                  description: "Toast hilang otomatis setelah beberapa detik.",
                  variant: "success",
                })
              }
              size="sm"
            >
              Toast sukses
            </Button>
            <Button
              onClick={() =>
                toast({
                  title: "Koneksi tidak tersedia",
                  description: "Ini hanya contoh pesan error.",
                  variant: "error",
                })
              }
              size="sm"
              variant="secondary"
            >
              Toast error
            </Button>
          </div>
          <EmptyState
            action={
              <Button
                onClick={() =>
                  toast({ title: "Aksi empty state DEMO", variant: "info" })
                }
                size="sm"
                variant="outline"
              >
                Coba aksi
              </Button>
            }
            description="Tampilan saat daftar belum memiliki data."
            title="Belum ada item"
          />
        </Card>
      </section>
    </div>
  );
}
