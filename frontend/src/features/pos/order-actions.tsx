import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { refundPosPayment, resolvePaymentAttempt, voidOrder, type OrderDetail } from "@/lib/pos-api";
import { ErrorNotice, Field, SaveModal } from "@/features/operations/shared";

type Callbacks = { close: () => void; saved: () => void };
export function ResolveModal({ attempt, close, saved }: Callbacks & { attempt: OrderDetail["attempts"][number] }) {
  const [status, setStatus] = useState<"paid" | "failed">("paid"); const [reference, setReference] = useState(""); const [note, setNote] = useState("");
  const [request, setRequest] = useState<{ status: "paid" | "failed"; reference: string; note: string } | null>(null);
  return <SaveModal title="Verifikasi settlement" description="Cocokkan mutasi provider secara manual. QRIS/kartu belum terhubung otomatis." onClose={close} onSave={async () => {
    if (note.trim().length < 3 || (status === "paid" && reference.trim().length < 3)) throw new Error("Catatan dan referensi settlement wajib diisi.");
    const next = request ?? { status, reference: reference.trim(), note: note.trim() }; setRequest(next);
    await resolvePaymentAttempt({ p_attempt_id: attempt.id, p_status: next.status, p_settlement_reference: next.reference || undefined, p_note: next.note }); saved();
  }}>
    <fieldset disabled={!!request} className="space-y-3"><Field label="Hasil"><Select value={status} onChange={e => setStatus(e.target.value === "failed" ? "failed" : "paid")}><option value="paid">Paid / terverifikasi</option><option value="failed">Failed / ditolak</option></Select></Field><Field label="Referensi settlement"><Input required={status === "paid"} minLength={status === "paid" ? 3 : undefined} maxLength={200} value={reference} onChange={e => setReference(e.target.value)} /></Field><Field label="Catatan verifikasi"><Input required minLength={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></Field></fieldset>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" required />Saya telah memeriksa bukti settlement atau kegagalan pembayaran sebenarnya.</label>
  </SaveModal>;
}
type RefundIntent = { key: string; amount: number; reason: string; reference: string };
function restoreRefund(key: string): { value: RefundIntent | null; error: string } {
  try {
    const raw = sessionStorage.getItem(key); if (!raw) return { value: null, error: "" }; const x: unknown = JSON.parse(raw);
    if (!x || typeof x !== "object" || !("key" in x) || typeof x.key !== "string" || !("amount" in x) || typeof x.amount !== "number" || !("reason" in x) || typeof x.reason !== "string" || !("reference" in x) || typeof x.reference !== "string") throw new Error("Invalid retry");
    return { value: { key: x.key, amount: x.amount, reason: x.reason, reference: x.reference }, error: "" };
  } catch { return { value: null, error: "Data retry refund rusak. Periksa histori dan rekonsiliasi dana sebelum mencoba dari tab baru." }; }
}
export function RefundModal({ payment, actor, close, saved }: Callbacks & { payment: OrderDetail["payments"][number]; actor: string }) {
  const storageKey = `suwanting-refund:${actor}:${payment.id}`; const [recovery] = useState(() => restoreRefund(storageKey)); const [intent, setIntent] = useState(recovery.value);
  const [amount, setAmount] = useState(intent?.amount ?? payment.amount); const [reason, setReason] = useState(intent?.reason ?? ""); const [reference, setReference] = useState(intent?.reference ?? "");
  return <SaveModal title="Refund pembayaran" description="Kembalikan dana sebenarnya dan pilih pembayaran asal. Stok tidak otomatis dikembalikan." onClose={close} submitLabel={intent ? "Ulangi request refund" : "Konfirmasi refund"} onSave={async () => {
    if (recovery.error) throw new Error(recovery.error);
    if (!Number.isFinite(amount) || amount <= 0 || reason.trim().length < 3 || (payment.method !== "cash" && reference.trim().length < 3)) throw new Error("Periksa nominal, alasan, dan referensi refund elektronik.");
    const next = intent ?? { key: crypto.randomUUID(), amount, reason: reason.trim(), reference: reference.trim() };
    sessionStorage.setItem(storageKey, JSON.stringify(next)); setIntent(next);
    try { await refundPosPayment({ p_payment_id: payment.id, p_amount: next.amount, p_reason: next.reason, p_idempotency_key: next.key, p_settlement_reference: next.reference || undefined }); }
    catch (error) { if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)) { sessionStorage.removeItem(storageKey); setIntent(null); } throw error; }
    sessionStorage.removeItem(storageKey); saved();
  }}>
    {recovery.error && <ErrorNotice error={recovery.error} />}{intent && <p className="text-xs text-secondary">Payload dikunci; retry menggunakan key refund yang sama.</p>}
    <fieldset disabled={!!intent || !!recovery.error} className="space-y-3"><Field label="Nominal refund"><Input required type="number" min="0.01" max={payment.amount} step="0.01" value={Number.isNaN(amount) ? "" : amount} onChange={e => setAmount(e.target.valueAsNumber)} /></Field><Field label="Alasan refund"><Input required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>{payment.method !== "cash" && <Field label="Referensi refund provider"><Input required minLength={3} maxLength={200} value={reference} onChange={e => setReference(e.target.value)} /></Field>}</fieldset>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" required />Saya mengonfirmasi pengembalian dana ini. Barang yang kembali memerlukan mutasi stok terpisah.</label>
  </SaveModal>;
}
export function VoidModal({ order, close, saved }: Callbacks & { order: string }) {
  const [reason, setReason] = useState("");
  return <SaveModal title="Void order" description="Hanya order terbuka tanpa dana tersisa atau payment pending yang boleh dibatalkan." onClose={close} submitLabel="Konfirmasi void" onSave={async () => { if (reason.trim().length < 3) throw new Error("Alasan void wajib diisi."); await voidOrder({ p_order_id: order, p_reason: reason }); saved(); }}><Field label="Alasan void"><Input required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field><label className="flex items-start gap-2 text-sm"><input type="checkbox" required />Saya mengonfirmasi pembatalan order ini.</label></SaveModal>;
}
