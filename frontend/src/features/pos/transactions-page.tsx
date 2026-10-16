import { useCallback, useState } from "react";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { money } from "@/lib/catalog-api";
import { orderHistory } from "@/lib/pos-api";
import { useDebounced, useRemote } from "@/features/operations/hooks";
import { ErrorNotice, Field, LoadingRows, PageFooter } from "@/features/operations/shared";
import { Workspace, type Scope } from "@/features/operations/workspace";
import { OrderDialog } from "./order-dialog";
import { useAccounts, useShift } from "./shift-panel";

export function TransactionsPage() { return <Workspace title="Transaksi" description="Histori order, payment status, settlement, void, refund, dan struk print-friendly.">{scope => <Transactions scope={scope} />}</Workspace>; }
function isoDay(value: string, add = 0) { if (!value) return undefined; const d = new Date(`${value}T00:00:00+07:00`); d.setUTCDate(d.getUTCDate() + add); return d.toISOString(); }
function Transactions({ scope }: { scope: Scope }) {
  const params = new URLSearchParams(window.location.search); const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const term = useDebounced(search); const [status, setStatus] = useState(""); const [payment, setPayment] = useState(""); const [openOnly, setOpenOnly] = useState(params.get("open") === "1"); const [from, setFrom] = useState(""); const [until, setUntil] = useState(""); const [detailId, setDetailId] = useState<string | null>(null); const shift = useShift(scope); const accounts = useAccounts(scope);
  const result = useRemote(useCallback(() => orderHistory(scope.org, scope.outlet, page, { search: term, from: isoDay(from), until: isoDay(until, 1), status, payment, openOnly }), [scope.org, scope.outlet, page, term, from, until, status, payment, openOnly]));
  const reset = () => setPage(1);
  return <div className="space-y-4"><Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_150px_150px_150px_150px_auto]"><Field label="Cari receipt / UUID"><Input placeholder="POS-… atau UUID order" value={search} onChange={e => { setSearch(e.target.value); reset(); }} /></Field><Field label="Dari (WIB)"><Input type="date" value={from} onChange={e => { setFrom(e.target.value); reset(); }} /></Field><Field label="Sampai (WIB)"><Input type="date" value={until} onChange={e => { setUntil(e.target.value); reset(); }} /></Field><Field label="Order status"><Select value={status} onChange={e => { setStatus(e.target.value); reset(); }}><option value="">Semua</option>{["held", "pending", "completed", "voided"].map(value => <option key={value}>{value}</option>)}</Select></Field><Field label="Payment status"><Select value={payment} onChange={e => { setPayment(e.target.value); reset(); }}><option value="">Semua</option>{["pending", "paid", "failed", "partial", "refunded", "partially_refunded"].map(value => <option key={value}>{value}</option>)}</Select></Field><label className="flex items-end gap-2 pb-2 text-xs"><input type="checkbox" checked={openOnly} onChange={e => { setOpenOnly(e.target.checked); reset(); }} /> Hanya held/pending</label></Card>
    <Card padded={false}>{result.loading ? <LoadingRows /> : result.error ? <ErrorNotice error={result.error} retry={result.refresh} /> : <>{!result.data?.rows.length ? <p className="p-6 text-sm text-secondary">Belum ada transaksi.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-secondary"><th className="p-4">Receipt</th><th className="p-4">Waktu</th><th className="p-4">Status</th><th className="p-4 text-right">Total</th><th className="p-4">Aksi</th></tr></thead><tbody>{result.data.rows.map(row => <tr className="border-b last:border-0" key={row.id}><td className="p-4 font-medium">{row.receipt_number ?? row.id.slice(0, 8)}</td><td className="p-4 text-xs text-secondary">{new Date(row.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td><td className="p-4"><div className="flex flex-wrap gap-1"><Badge variant={row.status === "completed" ? "success" : row.status === "voided" ? "danger" : "warning"}>{row.status}</Badge><Badge>{row.payment_status}</Badge></div></td><td className="p-4 text-right font-semibold">{money(row.total)}</td><td className="p-4"><Button size="sm" variant="secondary" onClick={() => setDetailId(row.id)}><FileText size={14} />Detail</Button></td></tr>)}</tbody></table></div>}<PageFooter page={page} result={result.data} onChange={setPage} /></>}</Card>
    {detailId && <OrderDialog scope={scope} id={detailId} shift={shift.data} accounts={accounts.data ?? []} close={() => setDetailId(null)} changed={() => { result.refresh(); shift.refresh(); }} />}
  </div>;
}
