import { ChevronLeft, Coffee, PanelLeftClose, X } from "lucide-react";
import { NavLink } from "react-router-dom";
import { appRoutes } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type SidebarProps = {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onCloseMobile: () => void;
};

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onCloseMobile,
}: SidebarProps) {
  const groups = ["Menu utama", "Pengelolaan"] as const;
  const showLabels = !collapsed || mobileOpen;

  return (
    <>
      {mobileOpen && (
        <button
          aria-label="Tutup menu navigasi"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onCloseMobile}
          type="button"
        />
      )}
      <aside
        aria-label="Navigasi utama"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[256px] flex-col border-r bg-surface transition-[width,transform] duration-200 lg:translate-x-0",
          collapsed && "lg:w-[84px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-[72px] shrink-0 items-center justify-between gap-3 border-b px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Coffee aria-hidden="true" size={21} />
            </span>
            {showLabels && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight">
                  Suwanting
                </p>
                <p className="text-[10px] text-secondary">COFFEE POS</p>
              </div>
            )}
          </div>
          <button
            aria-label="Tutup navigasi"
            className="grid size-9 place-items-center rounded-lg text-secondary hover:bg-elevated lg:hidden"
            onClick={onCloseMobile}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
          <button
            aria-label={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
            aria-pressed={collapsed}
            className="hidden size-8 shrink-0 place-items-center rounded-lg text-secondary hover:bg-elevated lg:grid"
            onClick={onToggleCollapsed}
            type="button"
          >
            {collapsed ? (
              <ChevronLeft aria-hidden="true" className="rotate-180" size={17} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={17} />
            )}
          </button>
        </div>

        <nav className="sidebar-scrollbar flex-1 overflow-y-auto px-3 py-5">
          {groups.map((group) => (
            <div className="mb-6" key={group}>
              {showLabels && (
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary">
                  {group}
                </p>
              )}
              <div className="space-y-1">
                {appRoutes
                  .filter((route) => route.group === group)
                  .map((route) => {
                    const Icon = route.icon;
                    return (
                      <NavLink
                        aria-label={!showLabels ? route.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            "group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                            isActive
                              ? "bg-primary-soft font-medium text-primary"
                              : "text-secondary hover:bg-elevated hover:text-foreground",
                            !showLabels && "justify-center px-0",
                          )
                        }
                        end={route.path === "/"}
                        key={route.path}
                        onClick={onCloseMobile}
                        title={!showLabels ? route.label : undefined}
                        to={route.path}
                      >
                        <Icon aria-hidden="true" className="shrink-0" size={19} />
                        {showLabels && <span>{route.label}</span>}
                      </NavLink>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        {showLabels && (
          <div className="m-3 rounded-2xl border bg-elevated p-3">
            <p className="text-xs font-medium">Butuh bantuan?</p>
            <p className="mt-1 text-[11px] leading-5 text-secondary">
              Gunakan Kasir untuk checkout server-side dan Transaksi untuk settlement/refund.
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
