import {
  BarChart3,
  Boxes,
  ClipboardList,
  Component,
  CircleDollarSign,
  LayoutDashboard,
  Package,
  Settings2,
  ShoppingCart,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type AppRoute = {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
  group: "Menu utama" | "Pengelolaan";
};

export const appRoutes: AppRoute[] = [
  {
    path: "/",
    label: "Dashboard",
    description: "Ringkasan operasional dan performa toko.",
    icon: LayoutDashboard,
    group: "Menu utama",
  },
  {
    path: "/cashier",
    label: "Kasir",
    description: "Katalog kasir, hold/resume, split payment, settlement, dan struk.",
    icon: ShoppingCart,
    group: "Menu utama",
  },
  {
    path: "/transactions",
    label: "Transaksi",
    description: "Riwayat dan detail transaksi yang tersimpan.",
    icon: ClipboardList,
    group: "Menu utama",
  },
  {
    path: "/products",
    label: "Produk",
    description: "Katalog dan harga produk.",
    icon: Package,
    group: "Pengelolaan",
  },
  {
    path: "/inventory",
    label: "Inventori",
    description: "Stok masuk, stok keluar, dan penyesuaian inventori.",
    icon: Boxes,
    group: "Pengelolaan",
  },
  {
    path: "/customers",
    label: "Pelanggan",
    description: "Data pelanggan dengan pengelolaan privasi yang sesuai.",
    icon: UsersRound,
    group: "Pengelolaan",
  },
  {
    path: "/finance",
    label: "Keuangan",
    description: "Kas, penerimaan, beban, aset, pinjaman, dan jurnal audit.",
    icon: CircleDollarSign,
    group: "Pengelolaan",
  },
  {
    path: "/reports",
    label: "Laporan",
    description: "Laporan penjualan dan rekonsiliasi.",
    icon: BarChart3,
    group: "Pengelolaan",
  },
  {
    path: "/settings",
    label: "Pengaturan",
    description: "Preferensi dan pengaturan operasional POS.",
    icon: Settings2,
    group: "Pengelolaan",
  },
  {
    path: "/ui-components",
    label: "Komponen UI",
    description: "Pratinjau komponen antarmuka yang digunakan aplikasi.",
    icon: Component,
    group: "Pengelolaan",
  },
];
