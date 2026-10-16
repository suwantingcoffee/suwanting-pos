import { useCallback, useState } from "react";
import { Plus, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { dbClient, readPage, type Row } from "@/lib/catalog-api";
import { useDebounced, useRemote } from "@/features/operations/hooks";
import {
  ConfirmAction,
  EmptyRows,
  ErrorNotice,
  Field,
  LoadingRows,
  PageFooter,
  SaveModal,
} from "@/features/operations/shared";
import { Workspace, type Scope } from "@/features/operations/workspace";

type Customer = Row<"customers">;

export function CustomersPage() {
  return (
    <Workspace
      description="Kelola data kontak pelanggan dengan akses terbatas dan histori yang tetap terjaga."
      title="Pelanggan"
    >
      {(scope) => <Customers scope={scope} />}
    </Workspace>
  );
}

function Customers({ scope }: { scope: Scope }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Customer | "new" | null>(null);
  const [archive, setArchive] = useState<Customer | null>(null);
  const term = useDebounced(search);
  const canManage = ["owner", "admin", "manager", "cashier"].includes(scope.role);
  const canRead = scope.role !== "inventory_staff";
  const result = useRemote(
    useCallback(
      () =>
        canRead
          ? readPage("customers", scope.org, page, {
              archived: status === "archived",
              search: term,
              searchColumn: "name",
            })
          : Promise.resolve({ rows: [], count: 0 }),
      [canRead, page, scope.org, status, term],
    ),
  );

  if (!canRead) {
    return (
      <Card>
        <p className="text-sm">
          Role inventori tidak memiliki akses ke data pelanggan.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">SUPABASE</Badge>
        <Badge>Data kontak terbatas</Badge>
      </div>
      <Card className="grid items-start gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="Cari nama pelanggan">
          <Input
            autoComplete="off"
            maxLength={160}
            placeholder="Nama pelanggan"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Status data">
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as "active" | "archived");
              setPage(1);
            }}
          >
            <option value="active">Aktif</option>
            <option value="archived">Diarsipkan</option>
          </Select>
        </Field>
        {canManage && (
          <Button className="self-end" onClick={() => setEdit("new")}>
            <Plus aria-hidden="true" size={16} />
            Pelanggan baru
          </Button>
        )}
      </Card>

      <Card padded={false}>
        {result.loading ? (
          <LoadingRows />
        ) : result.error ? (
          <ErrorNotice error={result.error} retry={result.refresh} />
        ) : (
          <>
            <DataTable
              columns={[
                {
                  key: "name",
                  header: "Pelanggan",
                  render: (customer) => (
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                        <UserRound aria-hidden="true" size={17} />
                      </span>
                      <div>
                        <p className="font-semibold">{customer.name}</p>
                        <p className="mt-1 text-secondary">
                          {new Intl.DateTimeFormat("id-ID", {
                            dateStyle: "medium",
                          }).format(new Date(customer.created_at))}
                        </p>
                      </div>
                    </div>
                  ),
                },
                {
                  key: "contact",
                  header: "Kontak",
                  render: (customer) => (
                    <div className="space-y-1">
                      <p>{customer.phone || "Telepon belum diisi"}</p>
                      <p className="text-secondary">
                        {customer.email || "Email belum diisi"}
                      </p>
                    </div>
                  ),
                },
                {
                  key: "actions",
                  header: "Tindakan",
                  render: (customer) => (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEdit(customer)}
                      >
                        {canManage ? "Edit" : "Lihat"}
                      </Button>
                      {canManage && (
                        <Button
                          size="sm"
                          variant={status === "active" ? "danger" : "secondary"}
                          onClick={() => setArchive(customer)}
                        >
                          {status === "active" ? "Arsipkan" : "Pulihkan"}
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
              getRowKey={(customer) => customer.id}
              rows={result.data?.rows ?? []}
            />
            {!result.data?.rows.length && <EmptyRows />}
            <PageFooter
              onChange={setPage}
              page={page}
              result={result.data}
            />
          </>
        )}
      </Card>

      {edit && (
        <CustomerEditor
          canManage={canManage}
          close={() => setEdit(null)}
          customer={edit === "new" ? null : edit}
          org={scope.org}
          saved={result.refresh}
        />
      )}
      {archive && (
        <ConfirmAction
          close={() => setArchive(null)}
          description="Data kontak akan disembunyikan dari daftar aktif. Transaksi dan struk lama tetap tertaut dan tidak dihapus."
          run={async () => {
            const { error } = await dbClient()
              .from("customers")
              .update({
                archived_at:
                  status === "active" ? new Date().toISOString() : null,
              })
              .eq("organization_id", scope.org)
              .eq("id", archive.id)
              .select("id")
              .single();
            if (error) throw error;
            result.refresh();
          }}
          title={
            status === "active"
              ? "Arsipkan pelanggan?"
              : "Pulihkan pelanggan?"
          }
        />
      )}
    </div>
  );
}

function CustomerEditor({
  canManage,
  close,
  customer,
  org,
  saved,
}: {
  canManage: boolean;
  close: () => void;
  customer: Customer | null;
  org: string;
  saved: () => void;
}) {
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");

  return (
    <SaveModal
      onClose={close}
      onSave={async () => {
        if (!canManage) return;
        const normalizedName = name.trim();
        if (!normalizedName || normalizedName.length > 160) {
          throw new Error("Isi nama pelanggan, maksimal 160 karakter.");
        }
        const values = {
          name: normalizedName,
          phone: phone.trim() || null,
          email: email.trim() || null,
        };
        const db = dbClient();
        const result = customer
          ? await db
              .from("customers")
              .update(values)
              .eq("organization_id", org)
              .eq("id", customer.id)
              .select("id")
              .single()
          : await db
              .from("customers")
              .insert({ organization_id: org, ...values })
              .select("id")
              .single();
        if (result.error) throw result.error;
        saved();
      }}
      readOnly={!canManage}
      submitLabel="Simpan pelanggan"
      title={customer ? "Detail pelanggan" : "Pelanggan baru"}
    >
      <fieldset disabled={!canManage} className="space-y-4">
        <Field label="Nama">
          <Input
            autoComplete="name"
            maxLength={160}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Nomor telepon">
          <Input
            autoComplete="tel"
            maxLength={40}
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>
        <Field label="Email">
          <Input
            autoComplete="email"
            maxLength={254}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <p className="text-xs leading-5 text-secondary">
          Simpan hanya informasi kontak yang diperlukan. Mengarsipkan pelanggan
          tidak menghapus histori transaksi.
        </p>
      </fieldset>
    </SaveModal>
  );
}
