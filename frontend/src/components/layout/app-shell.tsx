import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { ToastProvider } from "@/components/ui/toast";
import { AuthGate } from "@/features/operations/auth-gate";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return <AuthGate><ToastProvider><div className="min-h-dvh bg-background">
    <Sidebar
      collapsed={collapsed}
      mobileOpen={mobileOpen}
      onCloseMobile={() => setMobileOpen(false)}
      onToggleCollapsed={() => setCollapsed((current) => !current)}
    />
    <div className={`min-h-dvh min-w-0 transition-[padding] duration-200 ${collapsed ? "lg:pl-[84px]" : "lg:pl-[256px]"}`}>
      <Topbar onOpenMobileMenu={() => setMobileOpen(true)} />
      <main className="mx-auto w-full max-w-[1600px] min-w-0 p-4 sm:p-6 lg:p-8"><Outlet /></main>
    </div>
  </div></ToastProvider></AuthGate>;
}
