import { useCallback, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { financeOverview, postFinanceMutation, type FinanceOverview } from "./finance-api";
import { EmptyRows, ErrorNotice, Field, LoadingRows, SaveModal } from "@/features/operations/shared";
import { useRemote } from "@/features/operations/hooks";
import { Workspace, type Scope } from "@/features/operations/workspace";
import { dbClient, money, type Row } from "@/lib/catalog-api";

type FinanceData = {
  overview: FinanceOverview;
  accounts: Row<"cash_accounts">[];
  categories: Row<"expense_categories">[];
  chart: Row<"financial_accounts">[];
  expenses: Row<"expenses">[];
  movements: Row<"cash_movements">[];
  assets: Row<"assets">[];
  loans: Row<"loans">[];
  loanPayments: Row<"loan_payments">[];
  shifts: Row<"cashier_shifts">[];
  reconciliations: Row<"cash_reconciliations">[];
  journals: Row<"journal_entries">[];
  journalLines: Row<"journal_lines">[];
  activity: Row<"audit_logs">[];
};

type FormKind =
  | "expense" | "income" | "capital" | "asset" | "loan" | "loan_payment"
  | "reconcile" | "journal" | "reverse" | "account" | "category";

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const financeRoles = ["owner", "admin", "manager", "finance_staff"];

export function FinancePage() {
  return (
    <Workspace
      title="Keuangan"
      description="Pencatatan kas, penerimaan, beban, modal, pinjaman, aset, rekonsiliasi, dan jurnal double-entry."
    >
      {(scope) => <Finance scope={scope} />}
    </Workspace>
  );
}

function Finance({ scope }: { scope: Scope }) {
  const [from, setFrom] = useState(today);
  const [until, setUntil] = useState(tomorrow);
  const [tab, setTab] = useState("overview");
  const [form, setForm] = useState<FormKind | null>(null);
  const [selectedShift, setSelectedShift] = useState("");
  const canRead = financeRoles.includes(scope.role);
  const canManage = ["owner", "admin", "finance_staff"].includes(scope.role);
  const canReverse = ["owner", "admin", "manager"].includes(scope.role);
  const result = useRemote(useCallback(async () => {
    if (!canRead) return null;
    const db = dbClient();
    const [overview, accounts, categories, chart, expenses, movements, assets, loans, loanPayments,
      shifts, reconciliations, journals, activity] = await Promise.all([
      financeOverview(scope.org, scope.outlet, from, until),
      db.from("cash_accounts").select("*").eq("organization_id", scope.org).eq("outlet_id", scope.outlet).is("archived_at", null).order("name"),
      db.from("expense_categories").select("*").eq("organization_id", scope.org).is("archived_at", null).order("name"),
      db.from("financial_accounts").select("*").eq("organization_id", scope.org).is("archived_at", null).order("code"),
      db.from("expenses").select("*").eq("organization_id", scope.org).eq("outlet_id", scope.outlet).gte("incurred_on", from).lt("incurred_on", until).order("incurred_on", { ascending: false }).limit(50),
      db.from("cash_movements").select("*").eq("organization_id", scope.org).eq("outlet_id", scope.outlet).gte("created_at", `${from}T00:00:00`).lt("created_at", `${until}T00:00:00`).order("created_at", { ascending: false }).limit(50),
      db.from("assets").select("*").eq("organization_id", scope.org).eq("outlet_id", scope.outlet).order("acquired_on", { ascending: false }).limit(50),
      db.from("loans").select("*").eq("organization_id", scope.org).order("started_on", { ascending: false }).limit(50),
      db.from("loan_payments").select("*").eq("organization_id", scope.org).eq("outlet_id", scope.outlet).order("paid_on", { ascending: false }).limit(50),
      db.from("cashier_shifts").select("*").eq("organization_id", scope.org).eq("outlet_id", scope.outlet).order("opened_at", { ascending: false }).limit(50),
      db.from("cash_reconciliations").select("*").eq("organization_id", scope.org).eq("outlet_id", scope.outlet).order("created_at", { ascending: false }).limit(50),
      db.from("journal_entries").select("*").eq("organization_id", scope.org).eq("outlet_id", scope.outlet).gte("entry_date", from).lt("entry_date", until).order("entry_date", { ascending: false }).limit(50),
      db.from("audit_logs").select("*").eq("organization_id", scope.org).eq("outlet_id", scope.outlet).gte("created_at", `${from}T00:00:00`).lt("created_at", `${until}T00:00:00`).order("created_at", { ascending: false }).limit(50),
    ]);
    const responses = [accounts, categories, chart, expenses, movements, assets, loans, loanPayments, shifts, reconciliations, journals, activity];
    for (const response of responses) if (response.error) throw response.error;
    const journalLines = journals.data?.length
      ? await db.from("journal_lines").select("*").eq("organization_id", scope.org).in("journal_entry_id", journals.data.map((entry) => entry.id))
      : { data: [], error: null };
    if (journalLines.error) throw journalLines.error;
    return {
      overview,
      accounts: accounts.data ?? [],
      categories: categories.data ?? [],
      chart: chart.data ?? [],
      expenses: expenses.data ?? [],
      movements: movements.data ?? [],
      assets: assets.data ?? [],
      loans: loans.data ?? [],
      loanPayments: loanPayments.data ?? [],
      shifts: shifts.data ?? [],
      reconciliations: reconciliations.data ?? [],
      journals: journals.data ?? [],
      journalLines: journalLines.data ?? [],
      activity: activity.data ?? [],
    } satisfies FinanceData;
  }, [canRead, from, scope.org, scope.outlet, until]));

  if (!canRead) return <Card><p className="text-sm">Modul keuangan hanya tersedia untuk owner, admin, manager, dan finance_staff.</p></Card>;
  const data = result.data;
  const refresh = result.refresh;

  return (
    <div className="space-y-4">
      <Card className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <Field label="Tanggal mulai"><Input type="date" value={from} max={until} onChange={(event) => setFrom(event.target.value)} /></Field>
        <Field label="Tanggal akhir (eksklusif)"><Input type="date" value={until} min={from} onChange={(event) => setUntil(event.target.value)} /></Field>
        <Badge variant="success">IDR · double-entry</Badge>
        <Button variant="secondary" onClick={refresh}><RefreshCw size={15} />Segarkan</Button>
      </Card>
      <div className="flex flex-wrap gap-2">
        {[
          ["overview", "Ringkasan"], ["records", "Transaksi"], ["accounts", "Akun & kategori"],
          ["loans_assets", "Pinjaman & aset"], ["shifts", "Shift kasir"], ["journals", "Jurnal & audit"],
        ].map(([key, label]) => <Button key={key} variant={tab === key ? "primary" : "secondary"} onClick={() => setTab(key)}>{label}</Button>)}
      </div>
      {result.loading ? <Card><LoadingRows /></Card> : result.error ? <Card><ErrorNotice error={result.error} retry={refresh} /></Card> : !data ? null : <>
        {tab === "overview" && <Overview data={data.overview} />}
        {tab === "records" && <Records data={data} open={setForm} canManage={canRead} canManageCapital={canManage} />}
        {tab === "accounts" && <Accounts data={data} open={setForm} canManage={canManage} />}
        {tab === "loans_assets" && <LoansAssets data={data} open={setForm} canManage={canManage} />}
        {tab === "shifts" && <Shifts data={data} openReconciliation={(id) => { setSelectedShift(id); setForm("reconcile"); }} canManage={canRead} />}
        {tab === "journals" && <Journals data={data} open={setForm} canPost={canManage} canReverse={canReverse} />}
      </>}
      {form && data && <FinanceForm kind={form} scope={scope} data={data} selectedShift={selectedShift} close={() => setForm(null)} saved={refresh} />}
    </div>
  );
}

function Overview({ data }: { data: FinanceOverview }) {
  const metrics = [
    ["Omzet", data.gross_sales], ["Pembayaran diterima", data.payments_received], ["Refund", data.refunds],
    ["Pembayaran tertunda", data.pending_settlement], ["Kas masuk", data.cash_in], ["Kas keluar", data.cash_out],
    ["Pemasukan lain", data.other_income], ["Beban operasional", data.operating_expenses],
    ["Pembelian aset", data.asset_purchases], ["Modal pemilik", data.owner_capital],
    ["Penerimaan pinjaman", data.loan_proceeds], ["Pokok pinjaman dibayar", data.loan_principal_paid],
    ["Bunga pinjaman dibayar", data.loan_interest_paid], ["Biaya pinjaman", data.loan_fees_paid],
  ];
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value]) => <Card key={label as string}><p className="text-xs text-secondary">{label}</p><p className="mt-2 text-lg font-semibold">{money(value as number)}</p></Card>)}</div>
    <Card><h2 className="font-semibold">Saldo akun pembayaran</h2><p className="mt-1 text-xs text-secondary">Saldo kas pergerakan tercatat, tidak sama dengan omzet atau laba.</p><div className="mt-3 divide-y">{data.account_balances.map((account) => <div className="flex justify-between gap-3 py-2 text-sm" key={account.id}><span>{account.name} <span className="text-secondary">· {account.kind}</span></span><strong>{money(account.balance)}</strong></div>)}</div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-secondary"><span>{data.open_shifts} shift aktif</span><span>{data.unreconciled_shifts} shift belum direkonsiliasi</span></div>
    </Card>
  </div>;
}

function Records({ data, open, canManage, canManageCapital }: { data: FinanceData; open: (kind: FormKind) => void; canManage: boolean; canManageCapital: boolean }) {
  const cols = [
    { key: "date", header: "Tanggal", render: (row: Row<"cash_movements">) => new Date(row.created_at).toLocaleString("id-ID") },
    { key: "reason", header: "Jenis", render: (row: Row<"cash_movements">) => row.reason.replaceAll("_", " ") },
    { key: "value", header: "Nilai", render: (row: Row<"cash_movements">) => <span className={row.amount < 0 ? "text-danger" : "text-success"}>{money(row.amount)}</span> },
    { key: "account", header: "Akun kas", render: (row: Row<"cash_movements">) => data.accounts.find((account) => account.id === row.cash_account_id)?.name ?? row.cash_account_id },
    { key: "ref", header: "Referensi", render: (row: Row<"cash_movements">) => row.reference_id ?? "—" },
  ];
  return <div className="space-y-4">
    {canManage && <Card className="flex flex-wrap gap-2">
      <Button onClick={() => open("expense")}><Plus size={15} />Catat pengeluaran</Button>
      <Button onClick={() => open("income")}><Plus size={15} />Catat pemasukan</Button>
      {canManageCapital && <Button onClick={() => open("capital")}><Plus size={15} />Catat modal</Button>}
    </Card>}
    <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">Pergerakan kas</h2><p className="mt-1 text-xs text-secondary">Sumber transaksi, penerimaan, refund, beban, aset, dan pinjaman; setiap baris menghasilkan jurnal sesuai pemetaan.</p></div>
      <DataTable rows={data.movements} getRowKey={(row) => row.id} columns={cols} />{!data.movements.length && <EmptyRows />}</Card>
    <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">Pengeluaran operasional</h2><p className="mt-1 text-xs text-secondary">Pembelian aset dicatat terpisah dari beban operasional.</p></div>
      <DataTable rows={data.expenses} getRowKey={(row) => row.id} columns={[
        { key: "date", header: "Tanggal", render: (row) => row.incurred_on },
        { key: "description", header: "Keterangan", render: (row) => row.description },
        { key: "amount", header: "Nilai", render: (row) => money(row.amount) },
        { key: "category", header: "Kategori", render: (row) => data.categories.find((category) => category.id === row.expense_category_id)?.name ?? "—" },
      ]} />{!data.expenses.length && <EmptyRows />}</Card>
  </div>;
}

function Accounts({ data, open, canManage }: { data: FinanceData; open: (kind: FormKind) => void; canManage: boolean }) {
  return <div className="grid gap-4 lg:grid-cols-2">
    <Card padded={false}><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">Kas, bank, dan akun pembayaran</h2><p className="mt-1 text-xs text-secondary">Saldo bersumber dari ledger kas.</p></div>{canManage && <Button size="sm" onClick={() => open("account")}><Plus size={15} />Tambah akun</Button>}</div>
      <DataTable rows={data.accounts} getRowKey={(row) => row.id} columns={[
        { key: "name", header: "Akun", render: (row) => row.name },
        { key: "kind", header: "Jenis", render: (row) => row.kind },
        { key: "balance", header: "Saldo", render: (row) => money(data.overview.account_balances.find((balance) => balance.id === row.id)?.balance ?? 0) },
      ]} />{!data.accounts.length && <EmptyRows />}</Card>
    <Card padded={false}><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">Kategori pengeluaran</h2><p className="mt-1 text-xs text-secondary">Pengeluaran wajib memakai kategori aktif.</p></div>{canManage && <Button size="sm" onClick={() => open("category")}><Plus size={15} />Tambah kategori</Button>}</div>
      <DataTable rows={data.categories} getRowKey={(row) => row.id} columns={[
        { key: "name", header: "Kategori", render: (row) => row.name },
        { key: "created", header: "Dibuat", render: (row) => new Date(row.created_at).toLocaleDateString("id-ID") },
      ]} />{!data.categories.length && <EmptyRows />}</Card>
    <Card padded={false} className="lg:col-span-2"><div className="border-b p-4"><h2 className="font-semibold">Bagan akun jurnal</h2><p className="mt-1 text-xs text-secondary">Akun sistem dipakai oleh jurnal otomatis dan tidak dapat dihapus dari sini.</p></div>
      <DataTable rows={data.chart} getRowKey={(row) => row.id} columns={[
        { key: "code", header: "Kode", render: (row) => row.code },
        { key: "name", header: "Nama akun", render: (row) => row.name },
        { key: "kind", header: "Kelompok", render: (row) => row.kind },
      ]} /></Card>
  </div>;
}

function LoansAssets({ data, open, canManage }: { data: FinanceData; open: (kind: FormKind) => void; canManage: boolean }) {
  return <div className="space-y-4">
    {canManage && <Card className="flex flex-wrap gap-2"><Button onClick={() => open("asset")}><Plus size={15} />Pembelian aset</Button><Button onClick={() => open("loan")}><Plus size={15} />Catat pinjaman</Button>{data.loans.length > 0 && <Button variant="secondary" onClick={() => open("loan_payment")}><Plus size={15} />Catat angsuran</Button>}</Card>}
    <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">Aset</h2><p className="mt-1 text-xs text-secondary">Aset dicatat sebagai aset tetap, bukan beban operasional.</p></div><DataTable rows={data.assets} getRowKey={(row) => row.id} columns={[
      { key: "name", header: "Aset", render: (row) => row.name }, { key: "date", header: "Tanggal", render: (row) => row.acquired_on },
      { key: "cost", header: "Harga perolehan", render: (row) => money(row.acquisition_cost) }, { key: "life", header: "Umur manfaat", render: (row) => `${row.useful_life_months} bulan` },
    ]} />{!data.assets.length && <EmptyRows />}</Card>
    <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">Pinjaman dan angsuran</h2><p className="mt-1 text-xs text-secondary">Pokok mengurangi utang; bunga dicatat sebagai beban bunga terpisah.</p></div><DataTable rows={data.loans} getRowKey={(row) => row.id} columns={[
      { key: "lender", header: "Pemberi pinjaman", render: (row) => row.lender }, { key: "principal", header: "Pokok awal", render: (row) => money(row.principal) },
      { key: "interest", header: "Bunga tahunan", render: (row) => `${row.annual_interest_percent}%` },
      { key: "term", header: "Jatuh tempo", render: (row) => `${row.started_on} – ${row.due_on}` },
      { key: "payments", header: "Angsuran tercatat", render: (row) => money(data.loanPayments.filter((payment) => payment.loan_id === row.id).reduce((sum, payment) => sum + payment.principal_amount + payment.interest_amount + payment.fee_amount, 0)) },
    ]} />{!data.loans.length && <EmptyRows />}</Card>
    <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">Rincian pembayaran pinjaman</h2></div><DataTable rows={data.loanPayments} getRowKey={(row) => row.id} columns={[
      { key: "date", header: "Tanggal", render: (row) => row.paid_on }, { key: "loan", header: "Pinjaman", render: (row) => data.loans.find((loan) => loan.id === row.loan_id)?.lender ?? row.loan_id },
      { key: "principal", header: "Pokok", render: (row) => money(row.principal_amount) }, { key: "interest", header: "Bunga", render: (row) => money(row.interest_amount) },
      { key: "fee", header: "Biaya", render: (row) => money(row.fee_amount) },
      { key: "total", header: "Total", render: (row) => money(row.principal_amount + row.interest_amount + row.fee_amount) },
    ]} />{!data.loanPayments.length && <EmptyRows />}</Card>
  </div>;
}

function Shifts({ data, openReconciliation, canManage }: { data: FinanceData; openReconciliation: (id: string) => void; canManage: boolean }) {
  return <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">Shift kasir dan rekonsiliasi</h2><p className="mt-1 text-xs text-secondary">Rekonsiliasi mengunci hasil, mencatat selisih sebagai adjustment, dan membuat jurnal audit.</p></div>
    <DataTable rows={data.shifts} getRowKey={(row) => row.id} columns={[
      { key: "opened", header: "Mulai", render: (row) => new Date(row.opened_at).toLocaleString("id-ID") },
      { key: "closed", header: "Selesai", render: (row) => row.closed_at ? new Date(row.closed_at).toLocaleString("id-ID") : <Badge variant="warning">Aktif</Badge> },
      { key: "cashier", header: "Kasir", render: (row) => row.cashier_id },
      { key: "opening", header: "Kas awal", render: (row) => money(row.opening_cash) },
      { key: "closing", header: "Kas tutup", render: (row) => row.closing_cash === null ? "—" : money(row.closing_cash) },
      { key: "reconciliation", header: "Rekonsiliasi", render: (row) => {
        const reconciliation = data.reconciliations.find((item) => item.shift_id === row.id);
        return reconciliation ? <span>{money(reconciliation.variance)} selisih</span> : row.closed_at && canManage ? <Button size="sm" onClick={() => openReconciliation(row.id)}>Rekonsiliasi</Button> : "Belum tersedia";
      } },
    ]} />{!data.shifts.length && <EmptyRows />}</Card>;
}

function Journals({ data, open, canPost, canReverse }: { data: FinanceData; open: (kind: FormKind) => void; canPost: boolean; canReverse: boolean }) {
  return <div className="space-y-4">
    <Card className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Jurnal final bersifat append-only</h2><p className="mt-1 text-xs text-secondary">Koreksi dilakukan dengan jurnal reversal, bukan mengubah atau menghapus jurnal final.</p></div>{canPost && <Button onClick={() => open("journal")}><Plus size={15} />Jurnal manual</Button>}</Card>
    <Card padded={false}><DataTable rows={data.journals} getRowKey={(row) => row.id} columns={[
      { key: "date", header: "Tanggal", render: (row) => row.entry_date },
      { key: "description", header: "Keterangan", render: (row) => row.description },
      { key: "lines", header: "Rincian debit / kredit", render: (row) => {
        const lines = data.journalLines.filter((line) => line.journal_entry_id === row.id);
        const debit = lines.reduce((sum, line) => sum + line.debit, 0);
        const credit = lines.reduce((sum, line) => sum + line.credit, 0);
        return <div className="space-y-1">
          {lines.map((line) => {
            const account = data.chart.find((entry) => entry.id === line.financial_account_id);
            return <div className="text-xs" key={line.id}>{account ? `${account.code} · ${account.name}` : line.financial_account_id} — Dr {money(line.debit)} / Cr {money(line.credit)}</div>;
          })}
          <strong className="block text-xs">Total {money(debit)} = {money(credit)}</strong>
        </div>;
      } },
      { key: "reversal", header: "Status", render: (row) => row.reversal_of ? "Reversal" : data.journals.some((entry) => entry.reversal_of === row.id) ? "Sudah direversal" : "Final" },
      { key: "actions", header: "Tindakan", render: (row) => canReverse && !row.reversal_of && !data.journals.some((entry) => entry.reversal_of === row.id) ? <Button size="sm" variant="secondary" onClick={() => open("reverse")}>Reversal</Button> : "—" },
    ]} />{!data.journals.length && <EmptyRows />}</Card>
    <Card padded={false}><div className="border-b p-4"><h2 className="font-semibold">Riwayat aktivitas</h2><p className="mt-1 text-xs text-secondary">Log audit bersifat baca saja.</p></div><DataTable rows={data.activity} getRowKey={(row) => row.id} columns={[
      { key: "date", header: "Waktu", render: (row) => new Date(row.created_at).toLocaleString("id-ID") },
      { key: "table", header: "Objek", render: (row) => row.table_name },
      { key: "action", header: "Aksi", render: (row) => row.action },
      { key: "actor", header: "Pengguna", render: (row) => row.actor_id ?? "Sistem" },
    ]} />{!data.activity.length && <EmptyRows />}</Card>
  </div>;
}

function FinanceForm({ kind, scope, data, selectedShift, close, saved }: { kind: FormKind; scope: Scope; data: FinanceData; selectedShift: string; close: () => void; saved: () => void }) {
  const [amount, setAmount] = useState(0);
  const [principal, setPrincipal] = useState(0);
  const [interest, setInterest] = useState(0);
  const [fee, setFee] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(data.categories[0]?.id ?? "");
  const [loanId, setLoanId] = useState(data.loans[0]?.id ?? "");
  const [shiftId, setShiftId] = useState(selectedShift || (data.shifts.find((shift) => shift.closed_at)?.id ?? ""));
  const [date, setDate] = useState(today);
  const [life, setLife] = useState(60);
  const [percent, setPercent] = useState(0);
  const [secondName, setSecondName] = useState("");
  const [firstAccount, setFirstAccount] = useState(data.chart[0]?.id ?? "");
  const [secondAccount, setSecondAccount] = useState(data.chart.find((item) => item.id !== data.chart[0]?.id)?.id ?? "");
  const identity = { user: scope.userId, organization: scope.org, outlet: scope.outlet };
  const title: Record<FormKind, string> = {
    expense: "Catat pengeluaran", income: "Catat pemasukan lain", capital: "Catat modal pemilik",
    asset: "Pembelian aset", loan: "Catat pinjaman", loan_payment: "Catat angsuran pinjaman",
    reconcile: "Rekonsiliasi kasir", journal: "Posting jurnal manual", reverse: "Reversal jurnal",
    account: "Tambah akun pembayaran", category: "Tambah kategori pengeluaran",
  };
  const save = async () => {
    const argsBase = { p_organization_id: scope.org, p_outlet_id: scope.outlet };
    if (kind === "expense") await postFinanceMutation("record_expense_once", { ...argsBase, p_category_id: categoryId, p_cash_account_id: accountId, p_amount: amount, p_description: description, p_incurred_on: date }, identity);
    else if (kind === "income") await postFinanceMutation("record_income", { ...argsBase, p_cash_account_id: accountId, p_amount: amount, p_description: description, p_received_on: date }, identity);
    else if (kind === "capital") await postFinanceMutation("record_capital_contribution", { ...argsBase, p_cash_account_id: accountId, p_amount: amount, p_contributor: name, p_description: description }, identity);
    else if (kind === "asset") await postFinanceMutation("record_asset_purchase", { ...argsBase, p_cash_account_id: accountId, p_name: name, p_acquired_on: date, p_amount: amount, p_useful_life_months: life }, identity);
    else if (kind === "loan") await postFinanceMutation("record_loan", { ...argsBase, p_cash_account_id: accountId, p_lender: name, p_principal: amount, p_interest_percent: percent, p_started_on: date, p_due_on: secondName }, identity);
    else if (kind === "loan_payment") await postFinanceMutation("record_loan_payment", { p_loan_id: loanId, p_outlet_id: scope.outlet, p_cash_account_id: accountId, p_principal: principal, p_interest: interest, p_fee: fee, p_paid_on: date }, identity);
    else if (kind === "reconcile") await postFinanceMutation("reconcile_cashier_shift", { p_shift_id: shiftId, p_actual_cash: amount }, identity);
    else if (kind === "reverse") {
      const original = data.journals.find((journal) => journal.id === secondName);
      if (!original) throw new Error("Pilih jurnal yang masih aktif untuk direversal.");
      await postFinanceMutation("reverse_journal_entry", { p_journal_entry_id: original.id, p_reason: description }, identity);
    } else if (kind === "journal") {
      await postFinanceMutation("post_journal", {
        p_organization_id: scope.org, p_outlet_id: scope.outlet, p_description: description, p_entry_date: date,
        p_lines: [
          { financial_account_id: firstAccount, debit: amount, credit: 0 },
          { financial_account_id: secondAccount, debit: 0, credit: amount },
        ],
      }, identity);
    } else if (kind === "account") {
      const { error } = await dbClient().from("cash_accounts").insert({ organization_id: scope.org, outlet_id: scope.outlet, name, kind: secondName });
      if (error) throw error;
    } else if (kind === "category") {
      const { error } = await dbClient().from("expense_categories").insert({ organization_id: scope.org, name });
      if (error) throw error;
    }
    saved();
  };
  const amountField = (label = "Jumlah (IDR)") => <Field label={label}><Input type="number" min="0.01" step="0.01" required value={amount || ""} onChange={(event) => setAmount(event.target.valueAsNumber)} /></Field>;
  const accountField = <Field label="Akun pembayaran"><Select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Pilih akun</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.kind}</option>)}</Select></Field>;
  const dateField = <Field label="Tanggal"><Input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></Field>;
  return <SaveModal title={title[kind]} description="Transaksi diposting ke Supabase. Jurnal final tidak dapat diubah atau dihapus." onClose={close} onSave={save}>
    {(kind === "expense" || kind === "income" || kind === "capital" || kind === "asset" || kind === "loan" || kind === "loan_payment") && accountField}
    {kind === "expense" && <><Field label="Kategori"><Select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Pilih kategori</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></Field>{amountField()}<Field label="Keterangan"><Input required maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>{dateField}</>}
    {kind === "income" && <>{amountField()}<Field label="Sumber pemasukan"><Input required maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>{dateField}</>}
    {kind === "capital" && <><Field label="Nama pemilik/penyetor"><Input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></Field>{amountField()}<Field label="Keterangan"><Input required maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></Field></>}
    {kind === "asset" && <><Field label="Nama aset"><Input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></Field>{amountField("Harga perolehan (IDR)")}<Field label="Umur manfaat (bulan)"><Input type="number" min="1" max="1200" required value={life} onChange={(event) => setLife(event.target.valueAsNumber)} /></Field>{dateField}</>}
    {kind === "loan" && <><Field label="Pemberi pinjaman"><Input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></Field>{amountField("Pokok pinjaman (IDR)")}<Field label="Bunga tahunan (%)"><Input type="number" min="0" max="100" step="0.01" value={percent} onChange={(event) => setPercent(event.target.valueAsNumber)} /></Field>{dateField}<Field label="Tanggal jatuh tempo"><Input type="date" min={date} required value={secondName} onChange={(event) => setSecondName(event.target.value)} /></Field></>}
    {kind === "loan_payment" && <><Field label="Pinjaman"><Select required value={loanId} onChange={(event) => setLoanId(event.target.value)}>{data.loans.map((loan) => <option key={loan.id} value={loan.id}>{loan.lender} · {money(loan.principal)}</option>)}</Select></Field><Field label="Pokok dibayar (IDR)"><Input type="number" min="0" step="0.01" value={principal || ""} onChange={(event) => setPrincipal(event.target.valueAsNumber)} /></Field><Field label="Bunga dibayar (IDR)"><Input type="number" min="0" step="0.01" value={interest || ""} onChange={(event) => setInterest(event.target.valueAsNumber)} /></Field><Field label="Biaya pinjaman (IDR)"><Input type="number" min="0" step="0.01" value={fee || ""} onChange={(event) => setFee(event.target.valueAsNumber)} /></Field>{dateField}</>}
    {kind === "reconcile" && <><Field label="Shift ditutup"><Select required value={shiftId} onChange={(event) => setShiftId(event.target.value)}>{data.shifts.filter((shift) => shift.closed_at && !data.reconciliations.some((item) => item.shift_id === shift.id)).map((shift) => <option key={shift.id} value={shift.id}>{new Date(shift.opened_at).toLocaleString("id-ID")} · kas tutup {money(shift.closing_cash ?? 0)}</option>)}</Select></Field>{amountField("Kas aktual hasil hitung (IDR)")}</>}
    {kind === "journal" && <><Field label="Keterangan jurnal"><Input required maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>{dateField}<Field label="Akun debit"><Select value={firstAccount} onChange={(event) => setFirstAccount(event.target.value)}>{data.chart.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</Select></Field><Field label="Akun kredit"><Select value={secondAccount} onChange={(event) => setSecondAccount(event.target.value)}>{data.chart.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</Select></Field>{amountField()}<p className="text-xs text-secondary">Jurnal sederhana dua baris; debit dan kredit akan seimbang. Server tetap memvalidasi seluruh baris.</p></>}
    {kind === "reverse" && <><Field label="Jurnal yang dibalik"><Select required value={secondName} onChange={(event) => setSecondName(event.target.value)}><option value="">Pilih jurnal</option>{data.journals.filter((journal) => !journal.reversal_of && !data.journals.some((entry) => entry.reversal_of === journal.id)).map((journal) => <option key={journal.id} value={journal.id}>{journal.entry_date} · {journal.description}</option>)}</Select></Field><Field label="Alasan koreksi"><Input required maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></Field></>}
    {kind === "account" && <><Field label="Nama akun"><Input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Jenis"><Select value={secondName || "cash"} onChange={(event) => setSecondName(event.target.value)}><option value="cash">Kas</option><option value="bank">Bank</option><option value="ewallet">Akun pembayaran</option></Select></Field></>}
    {kind === "category" && <Field label="Nama kategori"><Input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field>}
  </SaveModal>;
}
