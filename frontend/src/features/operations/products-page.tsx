import { useDebounced, useRemote } from "./hooks";
import { useCallback, useState } from "react";
import { Package, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { collectPages, productPage, readPage, rpc, type Row } from "@/lib/catalog-api";
import { ConfirmAction, EmptyRows, ErrorNotice, Field, LoadingRows, Lookup, PageFooter, SaveModal } from "./shared";
import { Workspace, type Scope } from "./workspace";
import { MasterPanel } from "./master-panel";

export function ProductsPage() { return <Workspace title="Produk" description="Kelola katalog, varian, harga, dan satuan Suwanting Coffee.">{scope => <Products scope={scope} />}</Workspace>; }
function Products({ scope }: { scope: Scope }) {
  const [tab, setTab] = useState("products"); const [search, setSearch] = useState(""); const [category, setCategory] = useState(""); const [status, setStatus] = useState(""); const [page, setPage] = useState(1); const term = useDebounced(search);
  const [edit, setEdit] = useState<Row<"products"> | "new" | null>(null); const [remove, setRemove] = useState<Row<"products"> | null>(null);
  const result = useRemote(useCallback(() => productPage(scope.org, term, category, status, page), [scope.org, term, category, status, page]));
  return <div className="space-y-4"><div className="flex gap-2">{[["products", "Katalog"], ["categories", "Kategori"], ["units", "Satuan"]].map(([key, label]) => <Button key={key} variant={tab === key ? "primary" : "secondary"} onClick={() => setTab(key)}>{label}</Button>)}</div>
    {tab !== "products" ? <MasterPanel key={tab} table={tab === "categories" ? "categories" : "units"} scope={scope} /> : <>
      <Card className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]">
        <Field label="Pencarian"><Input placeholder="Nama, SKU, barcode, varian…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></Field>
        <Field label="Kategori"><Lookup table="categories" org={scope.org} value={category} onChange={value => { setCategory(value); setPage(1); }} placeholder="semua kategori" /></Field>
        <Field label="Status"><Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Semua status</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option></Select></Field>
        {scope.canWrite && <Button className="self-end" onClick={() => setEdit("new")}><Plus size={16} />Produk baru</Button>}
      </Card>
      <Card padded={false}>{result.loading ? <LoadingRows /> : result.error ? <ErrorNotice error={result.error} retry={result.refresh} /> : <>
        <DataTable rows={result.data?.rows ?? []} getRowKey={row => row.id} columns={[
          { key: "photo", header: "Foto", render: row => row.photo_url ? <img alt={row.name} src={row.photo_url} loading="lazy" referrerPolicy="no-referrer" className="size-12 rounded-xl object-cover" /> : <Package className="size-10 rounded-xl bg-primary-soft p-2 text-primary" /> },
          { key: "name", header: "Produk", render: row => <div><p className="font-semibold">{row.name}</p><p className="mt-1 max-w-xs truncate text-secondary">{row.description}</p></div> },
          { key: "status", header: "Status", render: row => <Badge variant={row.is_active ? "success" : "default"}>{row.is_active ? "Aktif" : "Nonaktif"}</Badge> },
          { key: "actions", header: "Tindakan", render: row => <div className="flex gap-2"><Button variant="secondary" size="sm" onClick={() => setEdit(row)}>{scope.canWrite ? "Edit & varian" : "Lihat varian"}</Button>{scope.canWrite && <Button size="sm" variant="danger" onClick={() => setRemove(row)}>Arsipkan</Button>}</div> },
        ]} />{!result.data?.rows.length && <EmptyRows />}<PageFooter result={result.data} page={page} onChange={setPage} />
      </>}</Card>
    </>}
    {edit && <ProductEditor scope={scope} product={edit === "new" ? null : edit} close={() => setEdit(null)} saved={result.refresh} />}
    {remove && <ConfirmAction title="Arsipkan produk?" description={`${remove.name}. Histori tetap tersimpan. Kosongkan stok terlebih dahulu.`} close={() => setRemove(null)} run={async () => { await rpc("archive_product", { p_product_id: remove.id }); result.refresh(); }} />}
  </div>;
}
type VariantDraft = { id?: string; name: string; sku: string; barcode: string; unit_id: string; price: number; acquisition_cost: number; sale_quantity: number; is_active: boolean; consumption_mode: string; sale_recipe_id: string | null };
const newVariant = (): VariantDraft => ({ name: "Reguler", sku: "", barcode: "", unit_id: "", price: 0, acquisition_cost: 0, sale_quantity: 1, is_active: true, consumption_mode: "stock", sale_recipe_id: null });
function ProductEditor({ scope, product, close, saved }: { scope: Scope; product: Row<"products"> | null; close: () => void; saved: () => void }) {
  const variants = useRemote(useCallback(async () => product ? collectPages(page => readPage("product_variants", scope.org, page, { parent: ["product_id", product.id], archived: false })) : [], [scope.org, product]));
  return variants.loading ? <SaveModal title="Memuat produk" onClose={close} onSave={async () => { throw new Error("Tunggu hingga data selesai dimuat."); }}><LoadingRows /></SaveModal> : variants.error ? <SaveModal title="Produk gagal dimuat" onClose={close} onSave={async () => { variants.refresh(); }}><ErrorNotice error={variants.error} retry={variants.refresh} /></SaveModal> : <ProductForm scope={scope} product={product} variants={variants.data ?? []} close={close} saved={saved} />;
}
function ProductForm({ scope, product, variants, close, saved }: { scope: Scope; product: Row<"products"> | null; variants: Row<"product_variants">[]; close: () => void; saved: () => void }) {
  const [name, setName] = useState(product?.name ?? ""); const [description, setDescription] = useState(product?.description ?? ""); const [category, setCategory] = useState(product?.category_id ?? ""); const [photo, setPhoto] = useState(product?.photo_url ?? ""); const [active, setActive] = useState(product?.is_active ?? true);
  const [drafts, setDrafts] = useState<VariantDraft[]>(variants.length ? variants.map(row => ({ ...row, barcode: row.barcode ?? "" })) : [newVariant()]);
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  function update(index: number, value: Partial<VariantDraft>) { setDrafts(rows => rows.map((row, i) => i === index ? { ...row, ...value } : row)); }
  return <SaveModal title={product ? "Detail & varian produk" : "Produk baru"} onClose={close} onSave={async () => {
    if (!scope.canWrite) { close(); return; }
    if (!name.trim() || !drafts.length || drafts.some(v => !v.name.trim() || !v.sku.trim() || !v.unit_id || !Number.isFinite(v.price) || !Number.isFinite(v.acquisition_cost) || !Number.isFinite(v.sale_quantity))) throw new Error("Lengkapi nama, SKU, satuan, harga dan jumlah jual setiap varian.");
    if (new Set(drafts.map(v => v.sku.trim())).size !== drafts.length) throw new Error("SKU varian harus unik.");
    if (photo && !/^https:\/\//.test(photo)) throw new Error("Foto harus menggunakan URL HTTPS.");
    await rpc("save_product", { p_organization_id: scope.org, p_product_id: product?.id ?? null, p_name: name.trim(), p_category_id: category || null, p_description: description || null, p_photo_url: photo || null, p_is_active: active, p_variants: drafts.map(v => ({ ...v, name: v.name.trim(), sku: v.sku.trim() })) }); saved();
  }} readOnly={!scope.canWrite} submitLabel="Simpan produk">
    <fieldset disabled={!scope.canWrite} className="space-y-4">
      <Field label="Nama produk"><Input required maxLength={160} value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Kategori"><Lookup table="categories" org={scope.org} value={category} onChange={setCategory} placeholder="kategori" /></Field>
      <Field label="Deskripsi"><Input maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      <Field label="URL foto HTTPS"><Input type="url" maxLength={2048} placeholder="https://…" value={photo} onChange={e => setPhoto(e.target.value)} /></Field>
      {/^https:\/\//.test(photo) && <img alt="Pratinjau foto" src={photo} referrerPolicy="no-referrer" className="h-32 w-full rounded-xl object-cover" />}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Produk aktif</label>
      <p className="text-xs text-secondary">Harga jual per penjualan; biaya awal per satuan stok. Jumlah per penjualan menentukan stok yang dipakai (contoh kemasan 100 g: satuan g, jumlah 100).</p>
      {drafts.map((v, i) => <div className="space-y-3 rounded-xl border bg-background p-3" key={v.id ?? `new-${i}`}>
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Varian {i + 1}</h3><Button aria-label={`Hapus varian ${i + 1}`} disabled={drafts.length === 1} variant="danger" size="sm" onClick={() => setPendingRemoval(i)}><Trash2 size={14} /></Button></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Ukuran / nama"><Input required maxLength={160} value={v.name} onChange={e => update(i, { name: e.target.value })} /></Field><Field label="SKU"><Input required maxLength={160} value={v.sku} onChange={e => update(i, { sku: e.target.value })} /></Field><Field label="Barcode"><Input maxLength={80} value={v.barcode} onChange={e => update(i, { barcode: e.target.value })} /></Field><Field label="Harga jual per penjualan (Rp)"><Input type="number" required min={0} step="0.01" value={v.price} onChange={e => update(i, { price: e.target.valueAsNumber })} /></Field><Field label="Biaya awal per satuan stok (Rp)"><Input type="number" required min={0} step="0.000001" value={v.acquisition_cost} onChange={e => update(i, { acquisition_cost: e.target.valueAsNumber })} /></Field><Field label="Jumlah stok per penjualan"><Input type="number" required min="0.0001" step="0.0001" value={v.sale_quantity} onChange={e => update(i, { sale_quantity: e.target.valueAsNumber })} /></Field></div>
        <Field label="Satuan stok"><Lookup table="units" org={scope.org} value={v.unit_id} onChange={value => update(i, { unit_id: value })} placeholder="satuan" /></Field>
        <Field label="Konsumsi penjualan"><Select value={v.consumption_mode} onChange={e => update(i, { consumption_mode: e.target.value, sale_recipe_id: e.target.value === "recipe" ? v.sale_recipe_id : null })}><option value="stock">Potong stok produk jadi</option><option value="recipe" disabled={!v.id}>Potong bahan resep saat dijual</option><option value="none">Tanpa stok</option></Select></Field>
        {v.consumption_mode === "recipe" && <Field label="Resep untuk varian ini"><Lookup table="recipes" org={scope.org} value={v.sale_recipe_id ?? ""} onChange={value => update(i, { sale_recipe_id: value || null })} parent={v.id ? ["output_variant_id", v.id] : undefined} placeholder="resep menu" /></Field>}
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={v.is_active} onChange={e => update(i, { is_active: e.target.checked })} />Varian aktif</label>
      </div>)}
      <Button disabled={drafts.length >= 100} variant="secondary" onClick={() => setDrafts(rows => [...rows, newVariant()])}>Tambah varian</Button>
    </fieldset>
    {pendingRemoval !== null && <div role="alert" className="rounded-xl bg-warning-soft p-3 text-sm"><p>Hapus varian {pendingRemoval + 1} dari formulir? Varian tersimpan akan diarsipkan saat produk disimpan.</p><div className="mt-2 flex gap-2"><Button size="sm" variant="danger" onClick={() => { setDrafts(rows => rows.filter((_, i) => i !== pendingRemoval)); setPendingRemoval(null); }}>Hapus varian</Button><Button size="sm" variant="secondary" onClick={() => setPendingRemoval(null)}>Batal</Button></div></div>}
  </SaveModal>;
}
