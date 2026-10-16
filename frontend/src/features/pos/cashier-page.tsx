import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pause, ReceiptText, Search, ShoppingCart, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { errorMessage, money } from "@/lib/catalog-api";
import { holdOrder, posCatalog, type CatalogItem, type PosItem } from "@/lib/pos-api";
import { useDebounced, useRemote } from "@/features/operations/hooks";
import { ErrorNotice, Field, Lookup } from "@/features/operations/shared";
import { Workspace, type Scope } from "@/features/operations/workspace";
import { OrderDialog } from "./order-dialog";
import { ShiftPanel, useAccounts, useShift } from "./shift-panel";

type CartLine = CatalogItem & { quantity: number; note: string };
type HoldIntent = { key: string; shift: string; customer: string; promo: string; items: PosItem[] };
function restoreIntent(key: string): { value: HoldIntent | null; error: string } {
  try {
    const raw = sessionStorage.getItem(key); if (!raw) return { value: null, error: "" };
    const x: unknown = JSON.parse(raw);
    if (!x || typeof x !== "object" || !("key" in x) || typeof x.key !== "string" || !("shift" in x) || typeof x.shift !== "string" || !("customer" in x) || typeof x.customer !== "string" || !("promo" in x) || typeof x.promo !== "string" || !("items" in x) || !Array.isArray(x.items)) throw new Error("Invalid intent");
    const items: PosItem[] = x.items.map((line: unknown) => {
      if (!line || typeof line !== "object" || !("variant_id" in line) || typeof line.variant_id !== "string" || !("quantity" in line) || typeof line.quantity !== "number" || !("note" in line) || typeof line.note !== "string") throw new Error("Invalid item");
      return { variant_id: line.variant_id, quantity: line.quantity, note: line.note };
    });
    return { value: { key: x.key, shift: x.shift, customer: x.customer, promo: x.promo, items }, error: "" };
  } catch { return { value: null, error: "Data retry order tidak dapat dibaca. Periksa histori transaksi sebelum melanjutkan melalui tab baru." }; }
}
export function CashierPage() {
  return <Workspace title="Kasir" description="Katalog, hold order, pembayaran, dan stok terhubung ke Supabase.">{scope => ["owner", "admin", "manager", "cashier"].includes(scope.role) && scope.outlet ? <Cashier scope={scope} /> : <Card>Kasir memerlukan outlet aktif dan role owner, admin, manager, atau cashier.</Card>}</Workspace>;
}
function Cashier({ scope }: { scope: Scope }) {
  const toast = useToast(); const shift = useShift(scope); const accounts = useAccounts(scope);
  const [search, setSearch] = useState(""); const term = useDebounced(search); const [category, setCategory] = useState(""); const [page, setPage] = useState(1);
  const [cart, setCart] = useState<CartLine[]>([]); const [customer, setCustomer] = useState(""); const [promo, setPromo] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null); const [busy, setBusy] = useState(false); const running = useRef(false); const [cartOpen, setCartOpen] = useState(false);
  const storageKey = `suwanting-pos-hold:${scope.userId}:${scope.org}:${scope.outlet}`;
  const [recovery, setRecovery] = useState(() => restoreIntent(storageKey));
  const catalog = useRemote(useCallback(() => posCatalog(scope.org, scope.outlet, term, category || null, page), [scope.org, scope.outlet, term, category, page]));
  const total = useMemo(() => cart.reduce((sum, line) => sum + line.price * (Number.isFinite(line.quantity) ? line.quantity : 0), 0), [cart]);
  const locked = busy || !!recovery.value || !!recovery.error;
  const submit = async (pay: boolean) => {
    if (running.current) return;
    if (!shift.data && !recovery.value) return toast({ title: "Buka shift terlebih dahulu", variant: "error" });
    if (!recovery.value && (!cart.length || cart.some(line => !Number.isFinite(line.quantity) || line.quantity <= 0))) return toast({ title: "Periksa jumlah item", variant: "error" });
    if (recovery.error) return;
    running.current = true; setBusy(true);
    const next = recovery.value ?? { key: crypto.randomUUID(), shift: shift.data!.id, customer, promo: promo.trim(), items: cart.map(line => ({ variant_id: line.id, quantity: line.quantity, note: line.note })) };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next)); setRecovery({ value: next, error: "" });
      const id = await holdOrder({ p_organization_id: scope.org, p_outlet_id: scope.outlet, p_shift_id: next.shift, p_idempotency_key: next.key, p_items: next.items, p_customer_id: next.customer || null, p_promotion_code: next.promo || null });
      sessionStorage.removeItem(storageKey); setRecovery({ value: null, error: "" }); setCart([]); setCustomer(""); setPromo(""); setCartOpen(false);
      toast({ title: pay ? "Order siap dibayar" : "Order ditahan", description: "Tersimpan di histori transaksi.", variant: "success" }); setOrderId(id);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)) { sessionStorage.removeItem(storageKey); setRecovery({ value: null, error: "" }); }
      toast({ title: "Order belum berhasil dipastikan", description: errorMessage(error), variant: "error" });
    } finally { running.current = false; setBusy(false); }
  };
  return <div className="space-y-4 pb-16 md:pb-0">
    <ShiftPanel scope={scope} shift={shift.data} accounts={accounts.data ?? []} refresh={() => { shift.refresh(); accounts.refresh(); }} />
    {shift.error && <ErrorNotice error={shift.error} retry={shift.refresh} />}{accounts.error && <ErrorNotice error={accounts.error} retry={accounts.refresh} />}
    <Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline" to="/transactions?open=1">Order ditahan / lanjutkan order</Link>
    {recovery.error && <ErrorNotice error={recovery.error} />}
    {recovery.value && <Card><p className="mb-2 text-sm">Ada request order yang belum dipastikan. Keranjang dikunci agar retry tidak membuat order ganda.</p><Button disabled={busy} onClick={() => void submit(false)}>{busy ? "Memeriksa…" : "Periksa / ulangi request order"}</Button></Card>}
    <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card padded={false} className="min-w-0 overflow-hidden">
        <div className="border-b p-4"><h2 className="font-semibold">Katalog produk</h2><p className="text-xs text-secondary">{catalog.data?.count ?? 0} varian · harga dan stok server</p></div>
        <div className="space-y-3 border-b p-4"><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-secondary" /><Input aria-label="Cari produk kasir" className="pl-9" placeholder="Nama, SKU, atau barcode…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div><Field label="Kategori"><Lookup table="categories" org={scope.org} value={category} onChange={v => { setCategory(v); setPage(1); }} placeholder="semua kategori" /></Field></div>
        {catalog.loading ? <p className="p-6 text-sm text-secondary" role="status">Memuat katalog…</p> : catalog.error ? <ErrorNotice error={catalog.error} retry={catalog.refresh} /> : <>
          <div className="grid gap-3 p-4 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3">{catalog.data?.rows.map(item => <CatalogCard key={item.id} item={item} disabled={locked} onAdd={() => setCart(lines => { const old = lines.find(line => line.id === item.id); return old ? lines.map(line => line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line) : [...lines, { ...item, quantity: 1, note: "" }]; })} />)}{!catalog.data?.rows.length && <p className="text-sm text-secondary">Produk tidak ditemukan.</p>}</div>
          <div className="flex items-center justify-between border-t p-3 text-xs"><Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage(v => v - 1)}>Sebelumnya</Button><span>Halaman {page}</span><Button size="sm" variant="ghost" disabled={page * 24 >= (catalog.data?.count ?? 0)} onClick={() => setPage(v => v + 1)}>Berikutnya</Button></div>
        </>}
      </Card>
      <div id="pos-cart" className={`${cartOpen ? "block" : "hidden"} min-w-0 md:block`}>
        <Card className="h-fit md:sticky md:top-24 md:max-h-[calc(100dvh-120px)] md:overflow-y-auto"><div className="mb-4 flex items-center gap-2"><ShoppingCart size={19} className="text-primary" /><h2 className="font-semibold">Keranjang</h2><Badge>{cart.length}</Badge></div>
          {!cart.length ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-secondary">Belum ada item.</p> : <div className="space-y-3"><fieldset disabled={locked} className="space-y-3">{cart.map(line => <div className="rounded-xl border p-3" key={line.id}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold">{line.product_name} · {line.variant_name}</p><p className="text-xs text-secondary">{money(line.price)}</p></div><Button size="icon" variant="ghost" aria-label={`Hapus ${line.variant_name}`} onClick={() => setCart(lines => lines.filter(x => x.id !== line.id))}><Trash2 size={15} /></Button></div><div className="mt-2 grid grid-cols-[82px_1fr] gap-2"><Input aria-label={`Jumlah ${line.variant_name}`} type="number" min="0.0001" step="0.0001" value={Number.isNaN(line.quantity) ? "" : line.quantity} onChange={e => setCart(lines => lines.map(x => x.id === line.id ? { ...x, quantity: e.target.valueAsNumber } : x))} /><Input aria-label={`Catatan ${line.variant_name}`} maxLength={500} placeholder="Catatan item" value={line.note} onChange={e => setCart(lines => lines.map(x => x.id === line.id ? { ...x, note: e.target.value } : x))} /></div></div>)}<Field label="Kode promo"><Input maxLength={100} value={promo} onChange={e => setPromo(e.target.value)} placeholder="Opsional" /></Field><Field label="Pelanggan"><Lookup table="customers" org={scope.org} value={customer} onChange={setCustomer} placeholder="pelanggan (opsional)" /></Field></fieldset>
            <div className="flex items-center justify-between border-t pt-3 text-sm font-semibold"><span>Subtotal katalog</span><span>{money(total)}</span></div><div className="grid grid-cols-2 gap-2"><Button variant="secondary" disabled={locked} onClick={() => void submit(false)}><Pause size={15} />Tahan</Button><Button disabled={locked} onClick={() => void submit(true)}>{busy ? "Menyimpan…" : "Bayar"}</Button></div><p className="text-xs text-secondary">Diskon promo dan pajak outlet dihitung server. Tinjau total pada detail order sebelum membayar.</p>
          </div>}
        </Card>
      </div>
    </div>
    <div className="fixed inset-x-4 bottom-4 z-20 md:hidden"><Button className="w-full shadow-popover" onClick={() => { setCartOpen(v => !v); if (!cartOpen) setTimeout(() => document.getElementById("pos-cart")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}><ShoppingCart size={17} />{cartOpen ? "Tutup keranjang" : "Lihat keranjang"} ({cart.length}) · {money(total)}</Button></div>
    {orderId && <OrderDialog scope={scope} id={orderId} shift={shift.data} accounts={accounts.data ?? []} close={() => setOrderId(null)} changed={() => { shift.refresh(); catalog.refresh(); }} />}
  </div>;
}
function CatalogCard({ item, disabled, onAdd }: { item: CatalogItem; disabled: boolean; onAdd: () => void }) {
  const unavailable = item.available !== null && item.available <= 0;
  return <article className="flex min-w-0 flex-col rounded-2xl border bg-background p-3">{item.photo_url ? <img src={item.photo_url} alt="" loading="lazy" className="mb-3 h-28 w-full rounded-xl object-cover" /> : <div className="mb-3 grid h-28 place-items-center rounded-xl bg-primary-soft text-primary"><ReceiptText size={28} /></div>}<h3 className="truncate text-sm font-semibold">{item.product_name}</h3><p className="truncate text-xs text-secondary">{item.variant_name} · {item.sku}</p><p className="mt-1 font-semibold text-primary">{money(item.price)}</p><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className={unavailable ? "text-danger" : "text-secondary"}>{item.available === null ? "Tanpa stok" : `Stok ${item.available}`}</span><Button size="sm" disabled={disabled || unavailable} onClick={onAdd}>Tambah</Button></div></article>;
}
