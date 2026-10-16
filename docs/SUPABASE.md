# Backend Supabase Suwanting Coffee POS

Backend berada di proyek `Suwanting POS`, terpisah dari situs Beta. Ada 48 tabel,
RLS pada semuanya, 44 RPC publik, ledger append-only, jurnal berimbang, dan tipe
TypeScript yang dihasilkan dari migration. UI produk, inventori, kasir, transaksi,
pelanggan, keuangan, dashboard, dan laporan terhubung. Panduan modul ada di
[PRODUCTS_INVENTORY.md](PRODUCTS_INVENTORY.md), [FINANCE.md](FINANCE.md), dan
[REPORTING.md](REPORTING.md).

## Setup development

Memerlukan Node.js 20+, npm, Supabase CLI, dan Docker Desktop untuk stack penuh.
Jalankan dari root `Suwanting POS`:

```powershell
npm ci
npm --prefix frontend ci
npm test
npm run test:concurrency
npm run test:ui
npm run types
supabase start
supabase migration up --local
supabase status
```

`supabase start` memakai proyek lokal dari `supabase/config.toml`. Seed otomatis
dinonaktifkan. Jangan menjalankan `db reset` pada database berisi data; tidak ada
reset, DROP tabel/database, TRUNCATE, DELETE massal, impor Beta, atau deployment remote pada
implementasi/pengujian ini. Tes PGlite membuat database baru di memori setiap run.

Salin `frontend/.env.example` ke `frontend/.env.local`, isi:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key atau anon JWT lokal>
```

Untuk hosted staging baru, ambil **Project URL** dan **Publishable key** dari
Dashboard Supabase > Connect / Project Settings > API Keys. URL biasanya
`https://<project-ref>.supabase.co`. Kedua nilai ini memang publik; RLS/RPC yang
menegakkan izin. Variabel lama `VITE_SUPABASE_ANON_KEY` tetap diterima sebagai
fallback. Jangan isi `sb_secret_*`, JWT `service_role`, database password, atau
token privat pada variabel `VITE_*`. Validator klien menolak key server dan URL
non-HTTPS di luar localhost. Jangan membagikan output `supabase status` lengkap,
karena CLI juga menampilkan konfigurasi server.

```powershell
npm --prefix frontend run dev
npm --prefix frontend run build
```

Klien memakai PKCE, refresh sesi, dan storage key khusus `suwanting-pos-auth`.
Tanpa kedua variabel, klien bernilai `null` dan tampilan DEMO tetap tersedia.
Halaman `/products` dan `/inventory` menampilkan formulir login email/password,
pilihan organisasi/outlet berdasarkan membership yang dapat dibaca, serta tombol
keluar. Akun tanpa membership mendapat petunjuk setup. Login/role di UI tidak
pernah dianggap bukti hak akses; setiap query/RPC diperiksa database.

### Akun dan workspace development pertama

1. Setelah migration lokal terpasang, buka Studio `http://127.0.0.1:54323` dan
   buat akun pada Authentication > Users. Untuk staging baru, gunakan Dashboard
   Supabase pada proyek staging tersebut. UI signup dan pengelolaan member belum
   disediakan. Trigger Auth membuat profil tanpa mengambil role dari metadata.
2. Jalankan frontend, buka `/products`, lalu masuk dengan akun tadi.
3. Untuk organisasi development **baru**, jalankan contoh satu kali pada console
   browser di Vite development. Import memakai sesi akun yang baru masuk; tidak
   membutuhkan service-role key. Simpan `organizationId` jika pembuatan outlet
   gagal agar dapat mengulang langkah outlet saja tanpa membuat organisasi baru.

```js
const { supabase } = await import('/src/lib/supabase.ts');
if (!supabase) throw new Error('Konfigurasi Supabase belum diisi');
const { data: organizationId, error: organizationError } = await supabase.rpc(
  'create_organization', { p_name: 'Suwanting Coffee Development' }
);
if (organizationError) throw organizationError;
const { data: outlet, error: outletError } = await supabase.from('outlets')
  .insert({ organization_id: organizationId, code: 'MAIN', name: 'Outlet Utama' })
  .select('id').single();
if (outletError) throw outletError;
console.log({ organizationId, outletId: outlet.id });
```

4. Muat ulang `/products`; akun menjadi owner organisasi yang baru dibuat dan
   lokasi `MAIN` tersedia otomatis pada outlet. Isi satuan/kategori melalui UI
   atau jalankan seed development opt-in di bawah. Mulai dari produk/varian,
   kemudian catat stok awal melalui Barang masuk dengan biaya yang benar.
5. Buat akun Auth lain terlebih dahulu. Owner dapat memanggil `set_member` dengan
   UUID akun tersebut, role dan scope outlet; jangan INSERT membership langsung
   atau mengedit metadata Auth untuk memberi izin. Uji dengan akun organisasi dan
   role berbeda mengikuti [TEST_RESULTS.md](TEST_RESULTS.md).

## Migration dan database yang sudah berisi data

Panduan untuk proyek hosted produksi, bootstrap owner tanpa signup publik,
backup/restore, dan deployment Vercel ada di [DEPLOYMENT.md](DEPLOYMENT.md).
Jangan memakai alur organisasi development di browser console untuk bootstrap
akun produksi.

| Migration | Isi |
| --- | --- |
| `20261016000100_foundation.sql` | Organisasi, profil Auth, outlet, keanggotaan, enum, helper identitas |
| `20261016000200_domain.sql` | Katalog, stok, pembelian, produksi, POS, kas, keuangan, indeks FK |
| `20261016000300_authorization.sql` | Grants minimum, RLS, audit, imutabilitas, constraint jurnal |
| `20261016000400_operations.sql` | RPC sensitif dengan transaksi atomik dan pemeriksaan izin |
| `20261016000500_accounting.sql` | Bagan akun awal dan jurnal otomatis setiap mutasi uang |
| `20261016000600_privilege_fix.sql` | Hak penguncian pinjaman, validasi angka/nama, cabut role instalasi |
| `20261016000700_inventory_model.sql` | Lokasi, biaya, unit, varian dan snapshot, backfill additive |
| `20261016000800_inventory_operations.sql` | Mutasi atomik, transfer, opname, minimum dan pagination saldo |
| `20261016000900_purchasing_production.sql` | Penerimaan bersatuan, versi resep, hasil produksi aktual |
| `20261016001000_sale_consumption.sql` | Konsumsi tunggal checkout dan histori biaya/bahan |
| `20261016001100_catalog.sql` | Produk/varian atomik dan arsip |
| `20261016001200_catalog_search.sql` | Pencarian SKU/barcode/filter/pagination server |
| `20261016001300_inventory_indexes.sql` | Indeks FK tambahan |
| `20261016001400_pos_model.sql` | Status order/payment, snapshot, payment attempts, akun POS, RLS |
| `20261016001500_pos_operations.sql` | Hold/finalize atomik, pembayaran split, settlement manual, stok/jurnal |
| `20261016001600_pos_queries_refunds.sql` | Katalog kasir, histori, resume, refund, void, immutable guards |
| `20261016001700_finance_operations.sql` | Modal/pemasukan/aset idempoten, fee pinjaman, rekonsiliasi, reversal dan ringkasan keuangan |
| `20261016001800_reporting.sql` | Agregasi laporan terotorisasi per periode, outlet, produk, kategori dan metode pembayaran |

Semua file dibungkus transaksi. Tabel langsung memakai FORCE RLS dan pencabutan
grants API pada migration pembuatannya, sehingga kegagalan migration berikutnya
tetap menutup akses. Ini baseline untuk **proyek Supabase POS baru**,
bukan skema situs Beta. Sebelum staging, jalankan `supabase/preflight.sql` secara
read-only dan tinjau seluruh migration. Installer membutuhkan hak membuat schema
dan role, SELECT/REFERENCES/TRIGGER pada `auth.users`, serta hak memberikan
USAGE schema `auth` dan EXECUTE `auth.uid()` kepada role fungsi. Preflight
menampilkan hak-hak tersebut tanpa mengubahnya. Nama tabel, schema `private`, atau role
yang bertabrakan membuat instalasi gagal; migration sengaja tidak memakai
`IF NOT EXISTS` untuk menyembunyikan skema yang berbeda. Tabel di luar daftar POS
tidak diubah; tes mempertahankan baris, grants, dan RLS tabel yang tidak terkait.

Database berisi data harus dibackup dan dipulihkan ke staging dahulu. Buat
migration forward terpisah untuk pemetaan/backfill yang telah ditinjau, lalu
uji jumlah baris dan invariant sebelum deployment. Jangan memperbaiki collision
dengan DROP/reset. Tidak ada down migration destruktif; rollback rilis dilakukan
melalui perbaikan forward atau restore backup yang telah diuji. Jangan mengedit
migration yang sudah pernah diterapkan.

Untuk proyek **staging baru** yang sudah ditinjau, operator dapat memakai
`supabase link --project-ref <staging-ref>`, `supabase db push --dry-run`, lalu
`supabase db push`. Tidak satu pun perintah remote ini dijalankan dalam pekerjaan
ini. Atur email confirmation dan redirect URL hosted sesuai aplikasi sebenarnya;
konfigurasi email tanpa konfirmasi pada repo hanya untuk development lokal.

## POS kasir dan pembayaran

Kontrak lengkap, status, retry, provider, dan contoh UI ada di [POS.md](POS.md).

## Identitas, organisasi, role, dan outlet

`profiles.id` mengacu ke `auth.users.id`. Trigger Auth hanya mengisi profil kosong;
metadata signup diabaikan dan password sepenuhnya ditangani Supabase Auth.
`profiles` hanya bisa dibaca/diubah pemiliknya, pada kolom nama/avatar. Keanggotaan
memerlukan profil yang sudah ada. Profil/aktor historis yang masih direferensikan
tidak dapat dihapus begitu saja; nonaktifkan keanggotaan untuk mencabut akses.

Pengguna terautentikasi dapat membuat organisasi baru melalui
`create_organization(p_name)` dan menjadi owner organisasi **baru** itu. Ini model
onboarding mandiri. Hanya owner dapat menjalankan `set_member` untuk organisasi
miliknya. Admin tidak dapat mengelola keanggotaan atau menaikkan role. Perubahan
member mengunci baris organisasi dan tidak dapat menghilangkan owner aktif terakhir.

Satu user dapat menjadi anggota beberapa organisasi, satu membership per organisasi.
`outlet_id = NULL` pada membership berarti seluruh outlet; selain itu, akses
transaksi dibatasi ke satu outlet tersebut. Owner/admin harus seluruh outlet.
Katalog, unit, resep, pemasok, pelanggan, dan chart of accounts dibagikan dalam
organisasi; transaksi memakai outlet dan foreign key gabungan organisasi/outlet.
Referensi parent lintas organisasi ditolak meskipun user memiliki akses ke dua
organisasi. `journal_lines` mewarisi scope outlet melalui parent jurnal.

| Role | Hak utama |
| --- | --- |
| owner | Semua domain, pengelolaan member, audit, pengaturan |
| admin | Semua domain, audit/pengaturan; tidak mengubah member |
| manager | POS/refund, pembelian/approval, produksi/stok, promosi, baca keuangan, catat pengeluaran/pemasukan, rekonsiliasi dan reversal jurnal |
| cashier | Baca katalog, kelola pelanggan, buka/tutup shift sendiri, checkout |
| inventory_staff | Katalog/resep/pemasok, PO draft, penerimaan PO approved, produksi, waste, penyesuaian stok |
| finance_staff | Baca penjualan/stok, akun kas/keuangan/aset, transaksi keuangan, pinjaman, jurnal, settlement/refund POS; tidak dapat membalik jurnal |

Data master organisasi yang dapat diedit berlaku bersama bagi seluruh outlet.
Role yang dibatasi outlet masih dapat mengedit master sesuai matriks; pembatasan
outlet berlaku pada data yang memang memiliki outlet. `application_settings`
hanya menyimpan allowlist preferensi struk/timezone, bukan rahasia atau pengaturan
otorisasi. Tidak ada DELETE untuk sesi browser. Arsip hanya tersedia pada master;
perubahan susunan bahan melalui `save_recipe` meningkatkan versi, sementara
konsumsi/produksi selesai mempertahankan snapshot.
Arsip outlet mempertahankan akses baca riwayat, tetapi menolak transaksi baru.

Helper `private.has_role`, `can_access`, `can_view_outlet` memakai `auth.uid()` dan
membership aktif dari database. `organization_id` pada request hanya pemilih
data; tidak memberikan izin. Helper identitas dimiliki `pos_identity`, membaca
tabel membership dengan policy internal sederhana sehingga tidak memanggil policy
itu sendiri. RPC dimiliki `pos_writer`; audit dimiliki `pos_auditor`. Ketiga role
NOLOGIN, NOBYPASSRLS, tidak memiliki SUPERUSER/CREATEROLE/CREATE schema, dan tidak
diberikan ke `anon`/`authenticated`. SECURITY DEFINER memakai `search_path=''`
dan nama objek berkualifikasi. Hanya RPC yang ditinjau mendapat EXECUTE browser;
schema `private` tidak diekspos oleh API. Grant sementara untuk mewarisi/set role
instalasi dicabut pada migration terakhir. PostgreSQL 17 dapat menyisakan
membership administratif bawaan bagi pembuat role (`ADMIN`, tanpa `INHERIT`/`SET`);
installer CREATEROLE tetap administrator yang dipercaya, tetapi sesi browser tidak
mendapat membership tersebut. DBA/infrastruktur tetap bagian dari trust boundary.

## Kontrak operasi dan invariant

| RPC | Perilaku |
| --- | --- |
| `create_organization`, `set_member` | Onboarding dan pengelolaan membership owner |
| `open_shift`, `close_shift` | Satu shift terbuka per kasir dan drawer, pencatatan kas awal/akhir |
| `checkout` | Harga/nama dari DB, promosi aktif outlet, stok cukup, order/item/payment/kas/jurnal atomik |
| `refund_order` | Manager/finance ke atas, total refund tidak melebihi pembayaran, tanpa otomatis restock |
| `mutate_stock`, `set_minimum_stock`, `list_stock` | Mutasi lokasi atomik/idempoten, minimum stock dan pagination saldo |
| `adjust_inventory`, `record_waste` | Wrapper legacy; saldo dan ledger diubah bersama; saldo negatif ditolak |
| `create_purchase_order`, `approve_purchase_order`, `receive_purchase_order` | Draft → approved → full received; retry penerimaan tidak menambah stok dua kali |
| `produce_batch` | Wrapper legacy; formulir baru memakai `run_production` dengan input/yield aktual dan request key |
| `save_product`, `archive_product`, `search_product_ids` | Produk/varian atomik, arsip, pencarian SKU/barcode dan pagination |
| `receive_purchase_order_at`, `cancel_purchase_order` | Penerimaan pada lokasi eksplisit dan pembatalan PO terbuka |
| `save_recipe`, `run_production` | Resep berversi, konsumsi/yield aktual, snapshot dan biaya historis |
| `record_expense` | Pengeluaran, kas, jurnal atomik |
| `create_loan`, `pay_loan` | Pinjaman/pembayaran, pemisahan pokok/bunga, tolak lebih bayar pokok |
| `post_journal` | Minimal dua baris, debit/kredit positif satu sisi, total seimbang |
| `record_expense_once`, `record_income`, `record_capital_contribution` | Pencatatan idempoten, kas dan jurnal otomatis; kategori wajib untuk beban |
| `record_asset_purchase` | Harga perolehan sebagai aset tetap, terpisah dari beban operasional |
| `record_loan`, `record_loan_payment` | Penerimaan pinjaman dan cicilan idempoten; pokok, bunga, dan biaya pinjaman diposting terpisah |
| `reconcile_cashier_shift` | Hanya shift tertutup; hitung kas harapan dari ledger, simpan selisih sekali, adjustment/jurnal atomik |
| `reverse_journal_entry` | Reversal append-only dengan alasan; hanya owner/admin/manager, satu reversal per jurnal |
| `finance_overview` | Omzet, penerimaan, refund, pending settlement, kas, beban, aset, modal, pinjaman dan saldo akun secara terpisah |

Halaman `/finance` memakai RPC di atas untuk transaksi, serta membaca akun kas,
kategori beban, shift, jurnal, dan audit sesuai tenant/outlet. Dashboard tidak
mengartikan selisih omzet dengan penerimaan sebagai laba. Tidak ada workflow
four-eyes approval terpisah; otorisasi saat ini ditegakkan melalui role database.
Panduan fitur ada di [FINANCE.md](FINANCE.md).

`checkout.p_items` hanya menerima `[{ variant_id: UUID, quantity: number }]`.
Field harga/total/role/organisasi per item ditolak. Kuantitas maksimal 4 desimal,
uang 2 desimal, seluruh nilai non-finite ditolak pada constraint tabel. Indeks
unik menjaga idempotensi, FK gabungan menjaga tenant, constraint menjaga nilai
dan status. Transaksi stok per outlet diserialkan dengan advisory lock; refund,
shift, membership, dan pokok pinjaman memakai penguncian tambahan sesuai parent.

Persist `p_idempotency_key` checkout di cart sampai hasil diketahui. Retry dengan
key dan payload identik mengembalikan order yang sama; payload/kasir/outlet berbeda
menghasilkan error. Refund memiliki retry serupa; `post_journal` menolak key
duplikat secara eksplisit. `mutate_stock` dan `run_production` memakai request key
serta payload/aktor/outlet yang sama; penerimaan PO mengembalikan receipt yang
sudah ada. RPC legacy `adjust_inventory`, `record_waste`, `produce_batch`, serta
expense, loan/payment dan buka shift belum mempunyai kontrak retry idempoten;
jangan mengulangnya otomatis setelah timeout tanpa memeriksa hasil. Detail retry
formulir ada di [PRODUCTS_INVENTORY.md](PRODUCTS_INVENTORY.md).

Audit merekam actor dari Auth, tabel, record ID, aksi, organisasi/outlet dan waktu;
tidak menyalin token, password, PII, atau seluruh isi finansial. Audit, jurnal,
stok movement, kas movement, dan dokumen final tidak dapat diperbarui/dihapus
melalui browser. Koreksi memakai transaksi kompensasi. Constraint deferred menjaga
jurnal tetap seimbang pada COMMIT, di luar validasi RPC.

Setiap kas movement otomatis memposting jurnal: penjualan debit kas/kredit
pendapatan, refund kebalikannya, expense debit beban/kredit kas, pinjaman debit
kas/kredit utang, pembayaran debit pokok utang dan bunga/kredit kas. Kode sistem
1000/2000/4000/5000/6000 tidak dapat diubah jenis/kode/status aktif. Buku pembantu
kas memisahkan rekening, sedangkan GL memakai satu akun pengendali kas/bank.

Pilihan lingkup: IDR default per organisasi, pembayaran tercatat manual,
POS v2 menghitung pajak/diskon di server, mendukung split payment, uang kembalian, hold/resume, dan histori. Provider QRIS/kartu belum ditentukan: pembayaran elektronik disimpan sebagai `pending` sampai owner/admin/manager/finance memverifikasi settlement reference dan catatan. Tidak ada konfirmasi gateway palsu.

Batas yang masih berlaku: stok offline, penerimaan parsial, jurnal COGS/depresiasi otomatis, dan
penjadwalan bunga. `loan_payments` mencatat bunga yang telah dihitung operator.
Shift menyimpan kas aktual dan menyediakan rekonsiliasi selisih yang dapat diaudit.
Dashboard dan laporan memakai agregasi `analytics_report` dengan scope outlet
server-side; definisi metrik dan batas laporan dijelaskan di
[REPORTING.md](REPORTING.md).
Satuan varian adalah satuan stok kanonis; konversi g/kg dan ml/l serta valuasi
rata-rata per lokasi tersedia. Biaya stok warisan tidak direkonstruksi.

## Contoh akses TypeScript

Gunakan `frontend/src/lib/pos-api.ts`, tangani error RPC/query, dan tampilkan
kegagalan jaringan kepada kasir. Jangan mengubah role dalam localStorage sebagai
mekanisme otorisasi. Contoh setelah sesi Supabase Auth tersedia:

```ts
const memberships = await getMyMemberships();
const products = await listProducts(selectedOrganizationId);
const orderId = await checkout({
  p_organization_id: selectedOrganizationId,
  p_outlet_id: selectedOutletId,
  p_shift_id: shiftId,
  p_idempotency_key: persistedCartRequestId,
  p_items: [{ variant_id: variantId, quantity: 1 }],
  p_cash_account_id: drawerId,
});
```

Tipe `Row/Insert/Update/Relationships`, enum, dan RPC untuk 48 tabel dihasilkan
dengan `npm run types` dari katalog PostgreSQL hasil migration; tipe Insert tidak
berarti tabel boleh diinsert langsung (grants/RLS menentukan). Dengan CLI tersedia,
alternatif generator resmi: `supabase gen types typescript --local --schema public`.

## Seed development

`supabase/seed.sql` hanya menambahkan master development pada organisasi yang
sudah dibuat. Tidak membuat user/password/member, tidak menimpa nilai lama,
dan menolak berjalan tanpa opt-in. Setelah membuat akun/organisasi lokal melalui
Auth/RPC, jalankan pada koneksi SQL database lokal saja:

```sql
BEGIN;
SET LOCAL app.environment = 'development';
SELECT set_config('app.seed_organization_id', '<UUID-organisasi-development>', true);
-- Jalankan isi supabase/seed.sql pada sesi yang sama (psql: \i supabase/seed.sql).
COMMIT;
```

Flag adalah pengaman operasional, bukan pembatas terhadap DBA. Jangan menjalankan
seed pada staging/produksi. Fixtures tes berisi dua organisasi, semua role,
anggota nonaktif dan outsider; fixtures hanya dibuat pada database sementara/lokal.

## Pengujian dan batas verifikasi

`npm test` menjalankan PostgreSQL WASM (PGlite) dengan Auth minimal khusus harness.
Tes mengganti role menjadi `authenticated`/`anon`, mengisi identitas request,
menjalankan query/RPC dengan izin tersebut, lalu COMMIT/ROLLBACK; tes kebijakan
tidak memakai akses superuser. Pembuatan user dan pemeriksaan hasil invariant
memakai koneksi harness. Semua tabel tenant memiliki fixture berisi data agar
tes isolasi tidak lulus hanya karena tabel kosong. Login saja bukan bukti keamanan.
Tes modul frontend memakai SDK Supabase dengan fetch tiruan untuk memastikan
payload RPC benar, error jaringan/database diteruskan, dan checkout tidak
diulang otomatis tanpa keputusan pemanggil.
Satu tes tambahan memasang seluruh migration dengan installer CREATEROLE pemilik
database yang bukan superuser, lalu menjalankan fixture RPC. Tes itu memodelkan
hak instalasi yang dinyatakan di atas; kompatibilitas stack Supabase tetap harus
diverifikasi melalui suite HTTP lokal.

Untuk Auth JWT dan PostgREST sebenarnya, jalankan stack lokal dan:

```powershell
$env:SUPABASE_TEST_URL = 'http://127.0.0.1:54321'
$env:SUPABASE_TEST_PUBLISHABLE_KEY = '<public local anon/publishable key>'
npm run test:supabase
```

Tes HTTP membuat user melalui signup, memakai JWT masing-masing, menguji semua
role, dua organisasi, pembacaan/perubahan terlarang, FK tenant, ledger, pencabutan
akses, checkout retry bersamaan dan perebutan stok terakhir. Hosted URL ditolak.
Fixture lokal dipertahankan untuk inspeksi, tanpa reset/hapus. Tanpa key lokal,
suite dilewati dengan alasan eksplisit. PGlite tidak menguji GoTrue, PostgREST,
pooling, isolation multi-koneksi, konfigurasi hosted, atau delivery email. Tes
native `npm run test:concurrency` menguji race stok/checkout/receipt melalui
beberapa koneksi PostgreSQL sementara, tanpa gateway Supabase. Suite
HTTP dan pengujian staging masih diperlukan sebelum rilis. Hasil aktual ada di
[TEST_RESULTS.md](TEST_RESULTS.md).
