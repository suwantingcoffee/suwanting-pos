/* eslint-disable react-refresh/only-export-components */
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { collectPages, dbClient, money, readPage, rpc, type Row } from "@/lib/catalog-api";
import { useRemote } from "@/features/operations/hooks";
import { ErrorNotice, Field, SaveModal } from "@/features/operations/shared";
import type { Scope } from "@/features/operations/workspace";

export function useShift(scope: Scope) {
  return useRemote(useCallback(async () => {
    const { data, error } = await dbClient().from("cashier_shifts").select("*").eq("organization_id", scope.org).eq("outlet_id", scope.outlet).eq("cashier_id", scope.userId).is("closed_at", null).maybeSingle();
    if (error) throw error; return data;
  }, [scope.org, scope.outlet, scope.userId]));
}
export function useAccounts(scope: Scope) {
  return useRemote(useCallback(() => collectPages(page => readPage("cash_accounts", scope.org, page, { outlet: scope.outlet, archived: false })), [scope.org, scope.outlet]));
}
export function ShiftPanel({ scope, shift, accounts, refresh }: { scope: Scope; shift?: Row<"cashier_shifts"> | null; accounts: Row<"cash_accounts">[]; refresh: () => void }) {
  const [action, setAction] = useState<"open" | "close" | null>(null); const [account, setAccount] = useState(""); const [cash, setCash] = useState(0);
  return <Card className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-semibold">{shift ? "Shift kasir aktif" : "Buka shift untuk menerima pembayaran"}</p><p className="text-xs text-secondary">{shift ? `Kas awal ${money(shift.opening_cash)} · ${new Date(shift.opened_at).toLocaleString("id-ID")}` : "Pilih laci kas yang belum dipakai kasir lain."}</p></div><Button variant="secondary" size="sm" onClick={() => { setCash(0); setAction(shift ? "close" : "open"); }}>{shift ? "Tutup shift" : "Buka shift"}</Button>
    {action && <SaveModal title={action === "open" ? "Buka shift kasir" : "Tutup shift kasir"} onClose={() => setAction(null)} onSave={async () => {
      if (action === "open") { if (!account) throw new Error("Pilih laci kas."); await rpc("open_shift", { p_organization_id: scope.org, p_outlet_id: scope.outlet, p_cash_account_id: account, p_opening_cash: cash }); }
      else if (shift) await rpc("close_shift", { p_shift_id: shift.id, p_closing_cash: cash });
      refresh();
    }}>
      {action === "open" && <Field label="Laci kas"><Select required value={account} onChange={event => setAccount(event.target.value)}><option value="">Pilih laci kas</option>{accounts.filter(row => row.kind === "cash").map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</Select></Field>}
      <Field label={action === "open" ? "Kas awal (Rp)" : "Kas akhir aktual (Rp)"}><Input required type="number" min={0} step="0.01" value={cash} onChange={event => setCash(event.target.valueAsNumber)} /></Field>
      <label className="flex gap-2 text-sm"><input type="checkbox" required />Saya sudah menghitung kas fisik.</label>
      {action === "open" && !accounts.some(row => row.kind === "cash") && <ErrorNotice error="Belum ada laci kas. Owner/admin/finance perlu membuat cash account outlet melalui setup POS." />}
      <p className="text-xs text-secondary">Jika respons terputus, muat ulang status shift sebelum mencoba kembali.</p>
    </SaveModal>}
  </Card>;
}
