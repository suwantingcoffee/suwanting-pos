import { useRemote } from "./hooks";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { dbClient, errorMessage, stockPage } from "@/lib/catalog-api";
import type { AppRole } from "@/lib/pos-api";
import { ErrorNotice, Field, LoadingRows, Lookup } from "./shared";

export type Scope = { org: string; outlet: string; userId: string; role: AppRole; canWrite: boolean; canApprove: boolean };
export function Workspace({ title, description, children, inventory = false }: { title: string; description: string; inventory?: boolean; children: (scope: Scope) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null); const [authReady, setAuthReady] = useState(!supabase);
  const [org, setOrg] = useState(""); const [outlet, setOutlet] = useState(""); const [authError, setAuthError] = useState("");
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => { if (mounted) { setSession(data.session); setAuthReady(true); if (error) setAuthError(error.message); } });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthReady(true); });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);
  const uid = session?.user.id;
  const memberships = useRemote(useCallback(async () => {
    if (!uid) return [];
    const { data, error } = await dbClient().from("organization_members").select("organization_id,outlet_id,role,organizations(name)").eq("user_id", uid).eq("is_active", true).order("created_at");
    if (error) throw error; return data;
  }, [uid]));
  const current = memberships.data?.find(m => m.organization_id === org) ?? memberships.data?.[0];
  const orgId = current?.organization_id ?? "";
  const firstOutlet = useRemote(useCallback(async () => {
    if (!orgId) return "";
    const { data, error } = await dbClient().from("outlets").select("id").eq("organization_id", orgId).is("archived_at", null).order("name").limit(1);
    if (error) throw error; return data[0]?.id ?? "";
  }, [orgId]));
  const outletId = current?.outlet_id ?? (outlet || firstOutlet.data || "");
  const role = current?.role ?? "cashier";
  const canWrite = ["owner", "admin", "manager", "inventory_staff"].includes(role);
  return <div className="space-y-5">
    <div><Badge variant="success">SUPABASE</Badge><h1 className="mt-2 text-xl font-semibold sm:text-2xl">{title}</h1><p className="mt-1 text-sm text-secondary">{description}</p></div>
    {!supabase ? <Card><ErrorNotice error="Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY pada frontend/.env.local, lalu mulai ulang Vite." /></Card>
      : !authReady ? <LoadingRows /> : !session ? <Login onError={setAuthError} error={authError} />
      : memberships.loading ? <LoadingRows /> : memberships.error ? <ErrorNotice error={memberships.error} retry={memberships.refresh} />
      : !current ? <Card><p>Akun ini belum memiliki keanggotaan organisasi aktif.</p><p className="mt-2 text-sm text-secondary">Minta owner menambahkan akun melalui set_member. Panduan setup menjelaskan pembuatan organisasi pertama.</p><Button className="mt-4" variant="secondary" onClick={() => void dbClient().auth.signOut()}>Keluar</Button></Card>
      : <>
        <Card className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Organisasi"><Select value={orgId} onChange={e => { setOrg(e.target.value); setOutlet(""); }}>{memberships.data?.map(m => <option value={m.organization_id} key={m.organization_id}>{m.organizations?.name ?? m.organization_id}</option>)}</Select></Field>
          <Field label="Outlet"><Lookup key={orgId} table="outlets" org={orgId} value={outletId} onChange={setOutlet} placeholder="outlet" /></Field>
          <div className="flex items-center gap-2"><Badge>{role}</Badge><Button variant="ghost" onClick={async () => { const { error } = await dbClient().auth.signOut(); if (error) setAuthError(error.message); }}>Keluar</Button></div>
        </Card>
        {authError && <ErrorNotice error={authError} />}
        {firstOutlet.error && <ErrorNotice error={firstOutlet.error} retry={firstOutlet.refresh} />}
        {inventory && role === "cashier" ? <Card>Role kasir tidak memiliki akses modul inventori.</Card>
          : inventory && !outletId ? <Card>Belum ada outlet aktif. Tambahkan outlet melalui setup organisasi.</Card>
          : <div key={`${uid}:${orgId}:${outletId}:${role}`} className="space-y-4">{inventory && <LowStock org={orgId} outlet={outletId} />}{children({ org: orgId, outlet: outletId, userId: uid ?? "", role, canWrite, canApprove: ["owner", "admin", "manager"].includes(role) })}</div>}
      </>}
  </div>;
}
function LowStock({ org, outlet }: { org: string; outlet: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 30000); return () => clearInterval(timer); }, []);
  const result = useRemote(useCallback(() => { void tick; return stockPage(org, outlet, null, "", true, 1, 1); }, [org, outlet, tick]));
  if (result.error) return <ErrorNotice error={`Notifikasi stok gagal dimuat: ${result.error}`} retry={result.refresh} />;
  return <div className="flex items-center justify-between gap-3 rounded-xl border bg-warning-soft p-3 text-xs" role="status"><span>{result.loading ? "Memeriksa stok menipis…" : `${result.data?.count ?? 0} varian mencapai minimum stok di outlet ini.`} Diperbarui setiap 30 detik.</span><Button size="sm" variant="secondary" onClick={result.refresh}>Periksa</Button></div>;
}
function Login({ error, onError }: { error: string; onError: (value: string) => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false);
  return <Card className="mx-auto max-w-md"><h2 className="mb-4 font-semibold">Masuk ke workspace</h2><form className="space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); onError(""); try { const { error } = await dbClient().auth.signInWithPassword({ email, password }); if (error) throw error; setPassword(""); } catch (failure) { onError(errorMessage(failure)); } finally { setBusy(false); } }}>
    <Field label="Email"><Input autoComplete="username" type="email" required value={email} onChange={e => setEmail(e.target.value)} /></Field>
    <Field label="Password"><Input autoComplete="current-password" type="password" required value={password} onChange={e => setPassword(e.target.value)} /></Field>
    {error && <ErrorNotice error={error} />}<Button type="submit" disabled={busy}>{busy ? "Memeriksa akun…" : "Masuk"}</Button>
  </form></Card>;
}
