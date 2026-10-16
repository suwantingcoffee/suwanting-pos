import {
  Bell,
  ChevronDown,
  Menu,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { GlobalSearch } from "@/components/layout/global-search";
import { useTheme } from "@/providers/theme-provider";
import { appRoutes } from "@/lib/navigation";

type TopbarProps = {
  onOpenMobileMenu: () => void;
};

export function Topbar({ onOpenMobileMenu }: TopbarProps) {
  const location = useLocation();
  const currentRoute =
    appRoutes.find((route) => route.path === location.pathname) ?? appRoutes[0];
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const operational = ["/products", "/inventory", "/cashier", "/transactions"].includes(location.pathname);

  const notificationItems: DropdownItem[] = operational ? [{
    label: "Lihat notifikasi minimum stok di Inventori",
    onSelect: () => navigate("/inventory"),
  }] : [
    {
      label: "Semua data dashboard berlabel DEMO",
      icon: <span className="size-2 rounded-full bg-primary" />,
      onSelect: () => undefined,
    },
    {
      label: operational ? "Katalog, transaksi, dan stok memakai data Supabase" : "Produk dan inventori memakai data Supabase",
      icon: <span className="size-2 rounded-full bg-success" />,
      onSelect: () => undefined,
    },
  ];

  const profileItems: DropdownItem[] = [
    {
      label: operational ? "Akun dan role tersedia pada workspace modul" : "Profil demo",
      icon: <UserRound aria-hidden="true" size={16} />,
      onSelect: () => undefined,
    },
    {
      label: "Pengaturan",
      icon: <ChevronDown aria-hidden="true" size={16} />,
      onSelect: () => navigate("/settings"),
    },
  ];

  return (
    <header className="sticky top-0 z-30 border-b bg-surface backdrop-blur">
      <div className="flex min-h-[72px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          aria-label="Buka menu navigasi"
          className="grid size-10 shrink-0 place-items-center rounded-xl border text-secondary hover:bg-elevated lg:hidden"
          onClick={onOpenMobileMenu}
          type="button"
        >
          <Menu aria-hidden="true" size={19} />
        </button>

        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2">
            <span className="hidden text-xs text-secondary sm:inline">
              Suwanting POS
            </span>
            <span aria-hidden="true" className="hidden text-xs text-secondary sm:inline">
              /
            </span>
            <span
              aria-current="page"
              className="truncate text-sm font-semibold"
            >
              {currentRoute.label}
            </span>
          </nav>
          <p className="mt-0.5 hidden text-[11px] text-secondary sm:block">
            {operational ? "Operasional toko · Workspace Supabase" : "Operasional toko · Workspace demo"}
          </p>
        </div>

        <div className="hidden w-full max-w-[260px] md:block">
          <GlobalSearch />
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            aria-label={`Aktifkan mode ${theme === "light" ? "gelap" : "terang"}`}
            className="grid size-10 place-items-center rounded-xl text-secondary hover:bg-elevated hover:text-foreground"
            onClick={toggleTheme}
            type="button"
          >
            {theme === "light" ? (
              <Moon aria-hidden="true" size={18} />
            ) : (
              <Sun aria-hidden="true" size={18} />
            )}
          </button>

          <Dropdown
            items={notificationItems}
            label="Notifikasi"
            trigger={
              <span className="relative grid size-10 place-items-center rounded-xl text-secondary hover:bg-elevated hover:text-foreground">
                <Bell aria-hidden="true" size={18} />
                <span className="absolute right-2 top-2 size-2 rounded-full border-2 border-surface bg-primary" />
              </span>
            }
          />

          <div className="mx-1 hidden h-8 w-px bg-border sm:block" />

          <Dropdown
            items={profileItems}
            label={operational ? "Menu akun workspace" : "Menu profil pengguna demo"}
            trigger={
              <span className="flex items-center gap-2 rounded-xl p-1.5 text-left hover:bg-elevated">
                <span className="grid size-8 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                  SC
                </span>
                <span className="hidden max-w-28 sm:block">
                  <span className="block truncate text-xs font-medium">
                    {operational ? "Akun workspace" : "Staf Demo"}
                  </span>
                  <span className="block text-[10px] text-secondary">{operational ? "Supabase Auth" : "Kasir"}</span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="hidden text-secondary sm:block"
                  size={14}
                />
              </span>
            }
          />
        </div>
      </div>
      <div className="px-4 pb-3 md:hidden">
        <GlobalSearch />
      </div>
    </header>
  );
}
