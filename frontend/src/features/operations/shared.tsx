import { useRemote, useDebounced } from "./hooks";
import { cloneElement, isValidElement, useCallback, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { errorMessage, pageSize, readPage, type Page } from "@/lib/catalog-api";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const fieldId = useId();
  const simple = isValidElement<{ id?: string }>(children) && (children.type === Input || children.type === Select);
  return <div className="grid gap-1.5 text-xs font-medium" role={simple ? undefined : "group"} aria-labelledby={simple ? undefined : `${fieldId}-label`}>
    {simple ? <label htmlFor={fieldId}>{label}</label> : <span id={`${fieldId}-label`}>{label}</span>}
    {simple ? cloneElement(children, { id: fieldId }) : children}
  </div>;
}
export function ErrorNotice({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{error}{retry && <Button className="ml-2" size="sm" variant="secondary" onClick={retry}>Coba lagi</Button>}</div>;
}
export function PageFooter<T>({ result, page, onChange }: { result?: Page<T>; page: number; onChange: (value: number) => void }) {
  return <div className="p-4"><p className="mb-2 text-xs text-secondary">{result?.count ?? 0} data</p><Pagination page={page} pages={Math.max(1, Math.ceil((result?.count ?? 0) / pageSize))} onPageChange={onChange} /></div>;
}
export function LoadingRows() { return <p className="p-6 text-sm text-secondary" role="status">Memuat data…</p>; }
export function EmptyRows() { return <p className="p-6 text-sm text-secondary">Belum ada data yang sesuai.</p>; }

export function SaveModal({ title, description, onClose, onSave, children, submitLabel = "Simpan", readOnly = false }: {
  title: string; description?: string; onClose: () => void; onSave: () => Promise<void>; children: ReactNode; submitLabel?: string; readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const formId = useId(); const running = useRef(false); const toast = useToast();
  return <Modal open title={title} description={description} onOpenChange={open => { if (!open && !running.current) onClose(); }}
    footer={readOnly ? <Button variant="secondary" onClick={onClose}>Tutup</Button> : <><Button disabled={busy} variant="secondary" onClick={onClose}>Batal</Button><Button disabled={busy} form={formId} type="submit">{busy ? "Menyimpan…" : submitLabel}</Button></>}>
    <form id={formId} className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (readOnly || running.current) return; running.current = true; setBusy(true); setError("");
      try { await onSave(); toast({ title: "Perubahan tersimpan", variant: "success" }); onClose(); }
      catch (failure) { const message = errorMessage(failure); setError(message); toast({ title: "Gagal menyimpan", description: message, variant: "error" }); }
      finally { running.current = false; setBusy(false); }
    }}><fieldset disabled={busy} className="space-y-4">{children}</fieldset>{error && <ErrorNotice error={error} />}</form>
  </Modal>;
}
export function ConfirmAction({ title, description, run, close }: { title: string; description: string; run: () => Promise<void>; close: () => void }) {
  return <SaveModal title={title} description={description} onClose={close} onSave={run} submitLabel="Ya, lanjutkan"><p className="text-sm text-secondary">Pastikan tindakan dan lingkup outlet sudah benar sebelum melanjutkan.</p></SaveModal>;
}

// Search and page master selectors at the server instead of loading entire catalogs.
export function Lookup({ table, org, value, onChange, outlet, placeholder = "Pilih data", searchColumn = "name", parent, includeArchived = false }: {
  table: "categories" | "product_variants" | "suppliers" | "units" | "recipes" | "storage_locations" | "outlets" | "customers";
  org: string; value: string; onChange: (value: string) => void; outlet?: string; placeholder?: string; searchColumn?: string; parent?: [string, string]; includeArchived?: boolean;
}) {
  const [search, setSearch] = useState(""); const [page, setPage] = useState(1); const term = useDebounced(search); const id = useId();
  const parentKey = parent?.[0]; const parentValue = parent?.[1];
  const load = useCallback(() => readPage(table, org, page, { outlet, search: term, searchColumn, archived: includeArchived ? undefined : false, parent: parentKey && parentValue ? [parentKey, parentValue] : undefined }), [table, org, page, outlet, term, searchColumn, parentKey, parentValue, includeArchived]);
  const { data, error, loading, refresh } = useRemote(load);
  const selected = useRemote(useCallback(async () => {
    if (!value) return "";
    const result = await readPage(table, org, 1, { parent: ["id", value] });
    return result.rows[0]?.name ?? value;
  }, [table, org, value]));
  return <div className="space-y-1.5 rounded-xl border p-2">
    <Input aria-label={`Cari ${placeholder}`} placeholder={`Cari ${placeholder}…`} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
    <Select aria-label={placeholder} id={id} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{loading ? "Memuat…" : placeholder}</option>
      {value && !data?.rows.some(row => row.id === value) && <option value={value}>{selected.data || value}</option>}
      {data?.rows.map(row => <option key={row.id} value={row.id}>{"sku" in row ? `${row.sku} · ` : ""}{row.name}</option>)}
    </Select>
    {error && <ErrorNotice error={error} retry={refresh} />}
    {selected.error && <ErrorNotice error={selected.error} retry={selected.refresh} />}
    {(data?.count ?? 0) > pageSize && <div className="flex items-center justify-between text-xs"><Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Sebelumnya</Button><span>{page}</span><Button size="sm" variant="ghost" disabled={page * pageSize >= (data?.count ?? 0)} onClick={() => setPage(p => p + 1)}>Berikutnya</Button></div>}
  </div>;
}

