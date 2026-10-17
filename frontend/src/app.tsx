import { BrowserRouter, HashRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeProvider } from "@/providers/theme-provider";
import { Badge } from "@/components/ui/badge";
const ProductsPage = lazy(() => import("@/features/operations/products-page").then(module => ({ default: module.ProductsPage })));
const InventoryPage = lazy(() => import("@/features/operations/inventory-page").then(module => ({ default: module.InventoryPage })));
const CashierPage = lazy(() => import("@/features/pos/cashier-page").then(module => ({ default: module.CashierPage })));
const TransactionsPage = lazy(() => import("@/features/pos/transactions-page").then(module => ({ default: module.TransactionsPage })));
const CustomersPage = lazy(() => import("@/features/customers/customers-page").then(module => ({ default: module.CustomersPage })));
const FinancePage = lazy(() => import("@/features/finance/finance-page").then(module => ({ default: module.FinancePage })));
const DashboardPage = lazy(() => import("@/features/reports/reports-page").then(module => ({ default: module.DashboardPage })));
const ReportsPage = lazy(() => import("@/features/reports/reports-page").then(module => ({ default: module.ReportsPage })));

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);

  return null;
}

function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[55dvh] max-w-lg flex-col items-center justify-center text-center">
      <Badge variant="warning">404 · TIDAK DITEMUKAN</Badge>
      <h1 className="mt-4 text-2xl font-semibold">Halaman belum tersedia</h1>
      <p className="mt-2 text-sm text-secondary">
        Periksa alamat halaman atau kembali ke dashboard POS.
      </p>
      <Link
        className="mt-5 inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        to="/"
      >
        Kembali ke dashboard
      </Link>
    </div>
  );
}

function RoutedApp() {
  const useHashRouter = import.meta.env.VITE_USE_HASH_ROUTER === "true";
  const Router = useHashRouter ? HashRouter : BrowserRouter;
  const basename = useHashRouter ? "/" : import.meta.env.BASE_URL;

  return (
    <Router basename={basename}>
      <ScrollToTop />
      <Suspense fallback={<p className="p-6" role="status">Memuat modul…</p>}><Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route element={<ReportsPage />} path="/reports" />
          <Route element={<ProductsPage />} path="/products" />
          <Route element={<InventoryPage />} path="/inventory" />
          <Route element={<CashierPage />} path="/cashier" />
          <Route element={<TransactionsPage />} path="/transactions" />
          <Route element={<CustomersPage />} path="/customers" />
          <Route element={<FinancePage />} path="/finance" />
          <Route element={<NotFoundPage />} path="*" />
        </Route>
      </Routes></Suspense>
    </Router>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <RoutedApp />
    </ThemeProvider>
  );
}
