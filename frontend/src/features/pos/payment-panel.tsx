import { useState } from "react";
import { CreditCard, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { money, type Row } from "@/lib/catalog-api";
import { finalizePosOrder, type OrderDetail, type PaymentPart } from "@/lib/pos-api";
import { SaveModal, Field, ErrorNotice } from "@/features/operations/shared";
import type { Scope } from "@/features/operations/workspace";

const names = { cash: "Tunai", transfer: "Transfer", qris: "QRIS", card: "Kartu" };
type Draft = PaymentPart & { localId: string };
type Intent = { key: string; parts: PaymentPart[] };
function storedIntent(key: string): Intent | null {
  const text = sessionStorage.getItem(key); if (!text) return null;
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || !("key" in value) || typeof value.key !== "string" || !("parts" in value) || !Array.isArray(value.parts)) throw new Error("Data retry pembayaran rusak. Periksa histori transaksi sebelum membuat request baru.");
  const parts: PaymentPart[] = value.parts.map((part: unknown) => {
    if (!part || typeof part !== "object" || !("method" in part) || (part.method !== "cash" && part.method !== "transfer" && part.method !== "qris" && part.method !== "card") || !("amount" in part) || typeof part.amount !== "number" || !Number.isFinite(part.amount) || !("cash_account_id" in part) || typeof part.cash_account_id !== "string" || ("tendered_amount" in part && (typeof part.tendered_amount !== "number" || !Number.isFinite(part.tendered_amount)))) throw new Error("Invalid payment retry");
    return { method: part.method, amount: part.amount, cash_account_id: part.cash_account_id, ...("tendered_amount" in part ? { tendered_amount: Number(part.tendered_amount) } : {}) };
  });
  return { key: value.key, parts };
}
function readIntent(key: string) { try { return { value: storedIntent(key), error: "" }; } catch { return { value: null, error: "Data retry pembayaran rusak. Periksa histori sebelum mengirim pembayaran dari tab baru." }; } }
export function PaymentModal({ detail, accounts, shift, scope, close, saved }: { detail: OrderDetail; accounts: Row<"cash_accounts">[]; shift: Row<"cashier_shifts">; scope: Scope; close: () => void; saved: () => void }) {
  const storageKey = `suwanting-pos-payment:${scope.userId}:${scope.org}:${detail.order.id}`;
  const [recovery] = useState(() => readIntent(storageKey)); const [intent, setIntent] = useState(recovery.value);
  const confirmed = detail.payments.reduce((sum, row) => sum + row.amount, 0);
  const pending = detail.attempts.filter(row => row.status === "pending").reduce((sum, row) => sum + row.amount, 0);
  const remaining = Math.max(0, detail.order.total - confirmed - pending);
  const [parts, setParts] = useState<Draft[]>(() => (intent?.parts ?? (remaining > 0 ? [{ method: "cash" as const, cash_account_id: shift.cash_account_id, amount: remaining, tendered_amount: remaining }] : [])).map(part => ({ ...part, localId: crypto.randomUUID() })));
  const sum = parts.reduce((total, part) => total + part.amount, 0);
  const change = parts.reduce((total, part) => total + (part.method === "cash" ? Math.max(0, (part.tendered_amount ?? part.amount) - part.amount) : 0), 0);
  const update = (id: string, values: Partial<Draft>) => setParts(rows => rows.map(row => row.localId === id ? { ...row, ...values } : row));
  return <SaveModal title="Pembayaran / split payment" description={detail.order.receipt_number ?? detail.order.id} onClose={close} submitLabel={intent ? "Ulangi request yang sama" : "Proses pembayaran di server"} onSave={async () => {
    if (recovery.error) throw new Error(recovery.error);
    if (detail.refunds.length) throw new Error("Order yang sudah direfund tidak dapat dibayar ulang.");
    if (!intent && (parts.some(part => !part.cash_account_id || !Number.isFinite(part.amount) || part.amount <= 0 || (part.method === "cash" && (!Number.isFinite(part.tendered_amount) || (part.tendered_amount ?? 0) < part.amount))) || sum > remaining || (!parts.length && confirmed !== detail.order.total))) throw new Error("Periksa nominal dan rekening. Pembayaran pending harus diverifikasi sebelum finalisasi.");
    const next = intent ?? { key: crypto.randomUUID(), parts: parts.map(part => ({ cash_account_id: part.cash_account_id, method: part.method, amount: part.amount, ...(part.tendered_amount === undefined ? {} : { tendered_amount: part.tendered_amount }) })) };
    sessionStorage.setItem(storageKey, JSON.stringify(next)); setIntent(next);
    try { await finalizePosOrder({ p_order_id: detail.order.id, p_payments: next.parts, p_idempotency_key: next.key }); }
    catch (error) { if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)) { sessionStorage.removeItem(storageKey); setIntent(null); } throw error; }
    sessionStorage.removeItem(storageKey); saved();
  }}>
    <dl className="grid grid-cols-2 gap-2 rounded-xl bg-background p-3 text-sm"><dt>Total server</dt><dd className="text-right font-semibold">{money(detail.order.total)}</dd><dt>Sudah diterima</dt><dd className="text-right">{money(confirmed)}</dd><dt>Menunggu verifikasi</dt><dd className="text-right">{money(pending)}</dd><dt>Belum dialokasikan</dt><dd className="text-right">{money(remaining)}</dd></dl>
    {recovery.error && <ErrorNotice error={recovery.error} />}
    {intent && <ErrorNotice error="Request sudah dikirim. Data dikunci dan key tersimpan selama tab ini terbuka. Ulangi request yang sama untuk memeriksa hasil tanpa membuat pembayaran ganda." />}
    <fieldset disabled={!!intent} className="space-y-3">{parts.map((part, index) => <div className="space-y-3 rounded-xl border p-3" key={part.localId}><div className="flex items-center justify-between"><p className="text-sm font-semibold">Bagian {index + 1}</p><Button size="sm" variant="ghost" aria-label={`Hapus pembayaran ${index+1}`} onClick={() => setParts(rows => rows.filter(row => row.localId !== part.localId))}><Trash2 size={15} /></Button></div>
      <Field label={`Metode ${index+1}`}><Select value={part.method} onChange={event => { const method = event.target.value as PaymentPart["method"]; update(part.localId, { method, cash_account_id: method === "cash" ? shift.cash_account_id : "", tendered_amount: part.amount }); }}>{Object.entries(names).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field>
      <Field label={`Rekening ${index+1}`}><Select required value={part.cash_account_id} onChange={event => update(part.localId, { cash_account_id: event.target.value })}><option value="">Pilih rekening</option>{accounts.filter(account => part.method === "cash" ? account.id === shift.cash_account_id : part.method === "qris" ? account.kind !== "cash" : account.kind === "bank").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></Field>
      <Field label={`Nominal ${index+1} (Rp)`}><Input type="number" required min="0.01" step="0.01" value={part.amount} onChange={event => { const amount = event.target.valueAsNumber; update(part.localId, { amount, tendered_amount: amount }); }} /></Field>
      {part.method === "cash" && <Field label={`Uang diterima ${index+1} (Rp)`}><Input type="number" required min={part.amount} step="0.01" value={part.tendered_amount ?? part.amount} onChange={event => update(part.localId, { tendered_amount: event.target.valueAsNumber })} /></Field>}
    </div>)}<Button variant="secondary" disabled={parts.length>=10} onClick={() => setParts(rows => [...rows, { localId: crypto.randomUUID(), method: "qris", cash_account_id: "", amount: Math.max(0, remaining-sum) }])}><Plus size={15} />Tambah bagian pembayaran</Button></fieldset>
    <p className="flex items-center justify-between text-sm font-semibold"><span>Kembalian tunai</span><span>{money(change)}</span></p>
    {parts.some(part => part.method !== "cash") && <p className="rounded-xl bg-warning-soft p-3 text-xs text-warning">Transfer, QRIS, dan kartu tetap pending. Owner/admin/manager/finance harus mencocokkan settlement sebenarnya beserta referensinya. Provider belum dihubungkan.</p>}
    {remaining === 0 && confirmed === detail.order.total && <p className="rounded-xl bg-success-soft p-3 text-xs text-success">Dana sudah lengkap. Proses ini memfinalisasi stok dan jurnal penjualan.</p>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" required /><span><CreditCard size={14} className="mr-1 inline" />Nominal dan uang tunai sudah diperiksa.</span></label>
  </SaveModal>;
}
