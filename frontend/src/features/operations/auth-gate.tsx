import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { Card } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { LoadingRows } from "./shared";
import { Login } from "./workspace";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
      if (error) setAuthError(error.message);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setAuthReady(true);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signInError = (error: string) => setAuthError(error);
  if (!supabase) {
    return <AuthFrame><Card><h1 className="text-lg font-semibold">Konfigurasi aplikasi diperlukan</h1><p className="mt-2 text-sm text-secondary">Isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY` sebelum menjalankan aplikasi produksi.</p></Card></AuthFrame>;
  }
  if (!authReady) return <AuthFrame><LoadingRows /></AuthFrame>;
  if (!session) return <AuthFrame><Login error={authError} onError={signInError} /></AuthFrame>;
  return <>{children}</>;
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="grid min-h-dvh place-items-center bg-background p-4 sm:p-6"><div className="w-full max-w-md"><div className="mb-6 text-center"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Suwanting POS</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">Operasional toko</h1><p className="mt-1 text-sm text-secondary">Masuk untuk melanjutkan ke workspace produksi.</p></div>{children}<p className="mt-6 text-center text-xs text-secondary">Akses dilindungi Supabase Auth dan role organisasi.</p></div></main>;
}
