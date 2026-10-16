import { useDebounced, useRemote } from "./hooks";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { readPage, saveMaster, type Editable, type Row } from "@/lib/catalog-api";
import { ConfirmAction, EmptyRows, ErrorNotice, Field, LoadingRows, PageFooter, SaveModal } from "./shared";
import type { Scope } from "./workspace";

type MasterRow = Row<Editable>;
export function MasterPanel({ table, scope }: { table: Editable; scope: Scope }) {
  const title = { categories: "kategori", suppliers: "supplier", storage_locations: "lokasi penyimpanan", units: "satuan" }[table];
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const term = useDebounced(search); const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<MasterRow | "new" | null>(null); const [remove, setRemove] = useState<MasterRow | null>(null);
  const outlet = table === "storage_locations" ? scope.outlet : undefined;
  const result = useRemote(useCallback(() => readPage(table, scope.org, page, { search: term, archived, outlet }), [table, scope.org, page, term, archived, outlet]));
  return <Card padded={false}>
    <div className="flex flex-wrap items-center gap-3 p-4"><Input aria-label={`Cari ${title}`} className="sm:max-w-xs" placeholder={`Cari ${title}…`} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /><label className="text-xs"><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setPage(1); }} /> Arsip</label>{scope.canWrite && <Button onClick={() => setEdit("new")}>Tambah {title}</Button>}</div>
    {result.loading ? <LoadingRows /> : result.error ? <ErrorNotice error={result.error} retry={result.refresh} /> : <><DataTable rows={result.data?.rows ?? []} getRowKey={row => row.id} columns={[
      { key: "name", header: "Nama", render: row => row.name },
      { key: "info", header: "Detail", render: row => "code" in row ? row.code : "phone" in row ? `${row.phone || "—"} · ${row.email || "—"}` : "—" },
      { key: "action", header: "Tindakan", render: row => scope.canWrite ? <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit(row)}>Edit</Button>{!("is_default" in row && row.is_default) && <Button size="sm" variant="danger" onClick={() => setRemove(row)}>{row.archived_at ? "Pulihkan" : "Arsipkan"}</Button>}</div> : "Baca saja" },
    ]} />{!result.data?.rows.length && <EmptyRows />}<PageFooter page={page} result={result.data} onChange={setPage} /></>}
    {edit && <MasterForm key={edit === "new" ? "new" : edit.id} table={table} title={title} row={edit === "new" ? null : edit} scope={scope} close={() => setEdit(null)} saved={result.refresh} />}
    {remove && <ConfirmAction title={remove.archived_at ? `Pulihkan ${title}?` : `Arsipkan ${title}?`} description={remove.name} close={() => setRemove(null)} run={async () => { await saveMaster(table, scope.org, remove.id, { archived_at: remove.archived_at ? null : new Date().toISOString() }); result.refresh(); }} />}
  </Card>;
}
function MasterForm({ table, title, row, scope, close, saved }: { table: Editable; title: string; row: MasterRow | null; scope: Scope; close: () => void; saved: () => void }) {
  const [name, setName] = useState(row?.name ?? ""); const [code, setCode] = useState(row && "code" in row ? row.code : "");
  const [phone, setPhone] = useState(row && "phone" in row ? row.phone ?? "" : ""); const [email, setEmail] = useState(row && "email" in row ? row.email ?? "" : ""); const [address, setAddress] = useState(row && "address" in row ? row.address ?? "" : "");
  return <SaveModal title={`${row ? "Edit" : "Tambah"} ${title}`} onClose={close} onSave={async () => {
    if (!name.trim()) throw new Error("Nama wajib diisi.");
    if (table === "storage_locations") await saveMaster(table, scope.org, row?.id ?? null, { name: name.trim(), code: code.trim(), outlet_id: scope.outlet });
    else if (table === "units") { if (!["g", "kg", "ml", "l", "pcs", "pc"].includes(code.toLowerCase())) throw new Error("Gunakan g, kg, ml, l, atau pcs."); await saveMaster(table, scope.org, row?.id ?? null, { name: name.trim(), code: code.toLowerCase() }); }
    else if (table === "suppliers") await saveMaster(table, scope.org, row?.id ?? null, { name: name.trim(), phone: phone || null, email: email || null, address: address || null });
    else await saveMaster(table, scope.org, row?.id ?? null, { name: name.trim() });
    saved();
  }}>
    <Field label="Nama"><Input required maxLength={160} value={name} onChange={e => setName(e.target.value)} /></Field>
    {(table === "storage_locations" || table === "units") && <Field label={table === "units" ? "Kode (g, kg, ml, l, pcs)" : "Kode lokasi"}><Input required maxLength={40} disabled={table === "units" && !!row} value={code} onChange={e => setCode(e.target.value)} /></Field>}
    {table === "suppliers" && <><Field label="Telepon"><Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></Field><Field label="Email"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field><Field label="Alamat"><Input value={address} onChange={e => setAddress(e.target.value)} /></Field></>}
  </SaveModal>;
}
