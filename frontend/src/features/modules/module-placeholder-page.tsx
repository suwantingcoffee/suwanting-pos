import { useState } from "react";
import { ArrowRight, CircleAlert, Construction } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { appRoutes } from "@/lib/navigation";
import { useToast } from "@/components/ui/toast";

export function ModulePlaceholderPage() {
  const location = useLocation();
  const route = appRoutes.find((item) => item.path === location.pathname);
  const [showLoading, setShowLoading] = useState(false);
  const [showError, setShowError] = useState(false);
  const toast = useToast();

  if (!route) return null;
  const Icon = route.icon;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="demo">MODUL · PLACEHOLDER</Badge>
        <Badge>Belum terhubung ke database</Badge>
      </div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {route.label}
        </h1>
        <p className="mt-1 text-sm text-secondary">{route.description}</p>
      </div>

      {showLoading ? (
        <Card className="space-y-4">
          <div aria-label={`Memuat modul ${route.label}`} role="status">
            <span className="sr-only">Memuat modul...</span>
          </div>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-36 w-full" />
        </Card>
      ) : showError ? (
        <Card>
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <span className="mb-3 grid size-11 place-items-center rounded-xl bg-danger-soft text-danger">
              <CircleAlert aria-hidden="true" size={21} />
            </span>
            <h2 className="text-sm font-semibold">Pratinjau sedang tidak tersedia</h2>
            <p className="mt-1 max-w-md text-xs leading-5 text-secondary">
              Ini adalah error state demonstrasi. Belum ada koneksi atau
              permintaan produksi yang dijalankan.
            </p>
            <Button
              className="mt-4"
              onClick={() => setShowError(false)}
              variant="secondary"
            >
              Coba lagi
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col items-start gap-4 bg-gradient-to-br from-primary-soft to-surface p-6 sm:p-9">
            <span className="grid size-12 place-items-center rounded-2xl bg-surface text-primary shadow-card">
              <Icon aria-hidden="true" size={22} />
            </span>
            <div className="max-w-xl">
              <div className="mb-2 flex items-center gap-2">
                <Badge variant="demo">DALAM PERSIAPAN</Badge>
                <Construction aria-hidden="true" className="text-secondary" size={15} />
              </div>
              <h2 className="text-lg font-semibold tracking-tight">
                Modul {route.label.toLowerCase()} akan dibangun bertahap.
              </h2>
              <p className="mt-2 text-sm leading-6 text-secondary">
                Fondasi antarmuka sudah siap. Alur bisnis, hak akses, skema
                Supabase, serta validasi data perlu dirancang sebelum modul ini
                memproses data operasional.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setShowLoading(true);
                  window.setTimeout(() => setShowLoading(false), 1200);
                }}
                variant="primary"
              >
                Lihat loading state
              </Button>
              <Button
                onClick={() => setShowError(true)}
                variant="secondary"
              >
                Lihat error state
              </Button>
            </div>
          </div>
          <div className="grid gap-3 border-t bg-surface p-5 sm:grid-cols-2">
            <EmptyState
              description="Data demo terisolasi dan tidak ditampilkan sebagai data transaksi nyata."
              title="Belum ada data produksi"
            />
            <div className="flex flex-col justify-center rounded-xl border bg-background p-5">
              <p className="text-xs font-semibold">Tahap berikutnya</p>
              <p className="mt-1 text-xs leading-5 text-secondary">
                Tentukan alur dan persyaratan modul ini sebelum membuat skema
                maupun menyimpan data.
              </p>
              <Link
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                to="/ui-components"
              >
                Lihat komponen UI <ArrowRight aria-hidden="true" size={14} />
              </Link>
            </div>
          </div>
        </Card>
      )}
      <Button
        onClick={() =>
          toast({
            title: `Modul ${route.label} masih berupa placeholder`,
            description: "Tidak ada data produksi yang diubah.",
            variant: "info",
          })
        }
        variant="ghost"
      >
        Periksa status modul
      </Button>
    </div>
  );
}
