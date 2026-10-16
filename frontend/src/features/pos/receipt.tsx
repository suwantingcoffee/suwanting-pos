import { createPortal } from "react-dom";
import type { Json } from "@/lib/database.types";
import type { OrderDetail } from "@/lib/pos-api";
import { money } from "@/lib/catalog-api";
import "./receipt.css";

function text(snapshot: Json, key: string) { return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && typeof snapshot[key] === "string" ? snapshot[key] : ""; }
export function Receipt({ detail }: { detail: OrderDetail }) {
  const o = detail.order;
  return createPortal(<article className="pos-print-receipt" aria-label="Struk transaksi">
    <header><h1>{text(o.receipt_snapshot, "organization") || "Suwanting Coffee"}</h1><p>{text(o.receipt_snapshot, "outlet")}</p><p>{o.receipt_number ?? o.id}</p><p>{new Date(o.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p><p>Order: {o.status} · Pembayaran: {o.payment_status}</p>{o.status !== "completed" && <strong>BELUM MERUPAKAN PENJUALAN SELESAI</strong>}{text(o.receipt_snapshot, "customer") && <p>Pelanggan: {text(o.receipt_snapshot, "customer")}</p>}</header>
    <section>{detail.items.map(item => <div className="receipt-line" key={item.id}><strong>{item.product_name} · {item.variant_name}</strong><p>{item.sku_snapshot}</p><div className="receipt-pair"><span>{item.quantity} x {money(item.unit_price)}</span><span>{money(item.line_total)}</span></div>{item.note && <p>Catatan: {item.note}</p>}</div>)}</section>
    <section>{[["Subtotal", o.subtotal], ["Diskon", o.discount], [`Pajak ${o.tax_percent}%`, o.tax], ["TOTAL", o.total]].map(([name, value]) => <div className="receipt-pair" key={name}><span>{name}</span><strong>{money(Number(value))}</strong></div>)}</section>
    <section>{detail.payments.map(p => <div key={p.id}><div className="receipt-pair"><span>{p.method}</span><span>{money(p.amount)}</span></div>{p.method === "cash" && <><div className="receipt-pair"><span>Uang diterima</span><span>{money(Number(p.tendered_amount ?? 0))}</span></div><div className="receipt-pair"><span>Kembalian</span><span>{money(Number(p.change_amount ?? 0))}</span></div></>}</div>)}{detail.attempts.filter(a => a.status !== "paid").map(a => <p key={a.id}>{a.method} {money(a.amount)}: {a.status}</p>)}{detail.refunds.map(r => <p key={r.id}>Refund {money(r.amount)}: {r.reason}</p>)}</section>
    <footer>{text(o.receipt_snapshot, "footer") || "Terima kasih atas kunjungan Anda."}</footer>
  </article>, document.body);
}

