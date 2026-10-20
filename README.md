# Suwanting Coffee POS

Aplikasi kasir Laravel untuk minuman racikan dan kopi kemasan. Laravel 13.37, PHP 8.4, Blade, Tailwind CSS 4, Alpine.js 3, Lucide, dan Vite. Framework/versi persis dikunci di composer.lock dan package-lock.json.

## Menjalankan pada workspace ini

Database SQLite development baru sudah dimigrasi dan diisi data demo. PHP dan Composer portable tersedia di D:\Website\.tools. Dari folder ini:

~~~powershell
.\run.cmd
~~~

Launcher memakai PHP portable dari workspace bila tersedia, sehingga tidak memerlukan `php` di PATH. File `run.cmd` bisa dijalankan dari PowerShell maupun Command Prompt.

Jika port 8000 sedang digunakan, pilih port lain:

~~~powershell
.\run.cmd 8010
~~~

Lalu buka http://127.0.0.1:8010. `run.ps1` tetap tersedia, tetapi kebijakan PowerShell pada mesin ini memblokir script tersebut. Launcher `run.cmd` tidak memerlukan perubahan kebijakan Windows.

Alternatif tanpa launcher:

~~~powershell
& '..\.tools\php\php.exe' artisan serve --host=127.0.0.1 --port=8000
~~~

Buka http://127.0.0.1:8000. Untuk mengedit frontend, jalankan npm.cmd run dev di terminal lain. Server Laravel juga bisa berjalan memakai hasil npm.cmd run build tanpa Vite dev server.

Laravel harus berjalan melalui server PHP. Buka alamat server di browser; membuka `public/index.php` langsung atau memakai Live Server tidak menjalankan Laravel.

## Instalasi pada mesin baru

Prasyarat: PHP 8.4+ beserta pdo_mysql (MySQL), pdo_pgsql (Supabase), atau pdo_sqlite (demo/test), mbstring, openssl, curl, fileinfo, intl, xml, zip; Composer 2; Node.js 22.12+.

~~~powershell
composer install
npm.cmd ci
# Jalankan hanya jika .env belum ada:
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
php artisan key:generate
# Khusus database SQLite development baru:
if (-not (Test-Path database/database.sqlite)) {
    New-Item database/database.sqlite -ItemType File
}
php artisan migrate --seed
npm.cmd run build
php artisan serve --host=127.0.0.1 --port=8000
~~~

Jangan mengganti APP_KEY aplikasi yang sudah digunakan. Key dibuat sekali saat instalasi baru. Jangan menimpa .env atau menjalankan migrate:fresh/migrate:refresh pada data pengguna.

## Database MySQL

Demo lokal tetap memakai SQLite. Modul inventori dan test suite juga diuji pada MySQL Community 8.4.6 portable dengan database testing terpisah; konfigurasi database aplikasi tidak diganti.

Buat database development kosong, lalu sesuaikan .env:

~~~dotenv
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=suwanting_pos
DB_USERNAME=suwanting
DB_PASSWORD="isi-password-lokal"
~~~

Hapus/nonaktifkan DB_URL bila sebelumnya dipakai. Pastikan target database benar sebelum menjalankan:

~~~powershell
php artisan config:clear
php artisan migrate --pretend
php artisan migrate
# Opsional, hanya database development demo:
php artisan db:seed
~~~

## Database Supabase yang sudah ada

Laravel mengakses PostgreSQL dari backend. Project URL dan publishable/anon key bukan kredensial koneksi SQL. Ambil host, port, database, username dari Connect > Session pooler. Simpan password database hanya di .env lokal.

Gunakan schema khusus agar tidak bertabrakan dengan produk/cashflow milik aplikasi lain. Buat schema kosong lewat SQL Editor proyek yang benar:

~~~sql
create schema if not exists pos;
~~~

~~~dotenv
DB_CONNECTION=pgsql
DB_HOST="salin-host-session-pooler-dari-dashboard"
DB_PORT=5432
DB_DATABASE=postgres
DB_USERNAME="salin-username-dari-dashboard"
DB_PASSWORD="isi-password-database-lokal"
DB_SSLMODE=require
DB_SCHEMA=pos
~~~

Jangan menambahkan schema pos ke daftar exposed schemas Supabase Data API: aplikasi ini memakai autentikasi dan otorisasi Laravel, bukan akses langsung dari browser. Tidak ada service-role key di frontend.

Setelah memeriksa target dan hasil migrate --pretend, jalankan migrate. Seeder demo hanya opsional untuk development. Sambungan Supabase belum dijalankan karena kredensial proyek POS belum tersedia. Tidak ada database Supabase lain yang diubah.

## Data dan akun demo

Seeder hanya berjalan saat APP_ENV=local/testing dan POS_DEMO_MODE=true. Membuat tiga akun, lima kategori, 12 produk, varian Hot/Iced, dan delapan penjualan simulasi. Seeder memakai firstOrCreate dan melewati checkout demo yang sudah ada; tidak mengganti password, harga, status, atau data yang telah diubah. Akun yang sudah dimodifikasi mempertahankan password sebelumnya.

| Role | Email | Password awal |
| --- | --- | --- |
| Owner | owner@suwanting.test | SuwantingDemo!2026 |
| Admin | admin@suwanting.test | SuwantingDemo!2026 |
| Kasir | kasir@suwanting.test | SuwantingDemo!2026 |

Kredensial hanya didokumentasikan di README development ini, tidak dicantumkan pada halaman login publik. Hapus/nonaktifkan akun demo dan ganti rahasia sebelum penggunaan produksi. Mematikan POS_DEMO_MODE tidak menghapus data/akun demo yang sudah ada.

## Hak akses

| Operasi | Owner | Admin | Kasir |
| --- | --- | --- | --- |
| POS dan membuat penjualan | Ya | Ya | Ya |
| Riwayat/detail/struk | Semua | Semua | Milik sendiri |
| Produk/kategori/modal | Semua | Bila izin katalog aktif | Tidak |
| Inventori/satuan/resep/mutasi/laporan bahan | Semua | Bila izin katalog aktif | Tidak |
| Cari/pilih pelanggan aktif | Ya | Ya | Ya |
| Tambah/edit/nonaktifkan/arsipkan pelanggan | Ya | Ya | Tidak |
| Diskon | Ya | Bila izin diskon aktif | Tidak |
| Pengguna, pengaturan, laporan, audit | Ya | Tidak | Tidak |

Owner mengubah izin admin melalui manajemen pengguna. Backend menerapkan auth, active-user middleware, role middleware dan Gate. Owner tidak dapat menonaktifkan atau menurunkan role akun sendiri. Pengguna dinonaktifkan kehilangan sesi pada request berikutnya. Password di-hash; login dibatasi lima percobaan per menit untuk kombinasi email dan IP.

## Alur POS dan pembayaran

- Cari/filter produk, pilih varian, atur kuantitas/catatan, pelanggan, diskon berizin, dan metode pembayaran.
- Harga produk/varian, tarif pajak, subtotal, diskon, total, dan kembalian dihitung ulang di server. Uang memakai fixed-point integer saat hitung dan DECIMAL(12,2) di database.
- Setiap checkout menggunakan UUID idempotency key; pengulangan dengan payload sama mengembalikan invoice yang sama. Payload berbeda dengan key yang sudah dipakai ditolak. Unique constraint melindungi invoice/key; checkout per kasir diserialisasi dengan row lock pada MySQL/PostgreSQL.
- Sale, snapshot sale items, payment, dan audit dibuat dalam satu database transaction. Kegagalan pembayaran/write melakukan rollback.
- Tunai harus mempunyai nominal diterima yang cukup. QRIS/transfer memakai simulasi eksplisit, dapat berstatus menunggu atau lunas. Detail penjualan menyediakan konfirmasi simulasi yang diaudit dan aman diulang.
- POS_SIMULATE_PAYMENTS=false memblokir checkout non-tunai sampai gateway nyata ditambahkan. Pembayaran simulasi tetap diberi label walau mode demo dimatikan.
- Keranjang berada di memori tab; kegagalan checkout mempertahankan isinya. Refresh menutup pesanan yang belum disimpan. Jaringan internet diperlukan untuk database Supabase; tidak ada sinkronisasi offline.
- Transaksi lunas tidak mempunyai endpoint hapus. Produk diarsipkan dengan soft delete; snapshot histori tidak bergantung pada nama/harga katalog terbaru.
- Foto raster tervalidasi, maksimal 2 MB; disimpan di storage privat dan ditampilkan melalui route berautentikasi. Tidak perlu storage:link.
- Struk browser menampilkan item/varian, pajak, metode, diterima, kembalian, dan status. Pembayaran menunggu tidak disebut lunas.

## Pelanggan dan checkout opsional

Tab **Pelanggan** tersedia di sidebar dan navigasi mobile. Owner/admin dapat menambah, mengedit, menonaktifkan, dan mengarsipkan pelanggan; kasir melihat daftar pelanggan aktif. Nama wajib, telepon/email/alamat/catatan opsional. Catatan internal dan form edit hanya tersedia bagi owner/admin. Pencarian daftar serta kasir mendukung nama atau telepon.

Pada keranjang pilih **Pilih pelanggan terdaftar**, cari, lalu tekan nama pelanggan. Tombol **Ganti** mengembalikan pilihan pelanggan umum. Tetap bisa checkout tanpa pelanggan atau dengan nama/meja bebas. Pencarian dibatasi 20 hasil; ketik lebih lengkap bila pelanggan belum tampil.

Backend memeriksa pelanggan aktif dengan row lock dalam transaksi checkout, lalu menyimpan customer_id serta snapshot customer_name. Perubahan nama, status, atau arsip pelanggan tidak mengubah nama pada transaksi lama. Pengulangan checkout berhasil dengan payload yang sama tetap mengembalikan invoice lama, termasuk sesudah pelanggan diarsipkan. Tidak ada pemetaan otomatis nama bebas dari transaksi lama ke pelanggan baru.

Migration customers dan customer_id bersifat tambahan. Jalankan `php artisan migrate --no-interaction` untuk instalasi lama. CustomerSeeder opsional (`php artisan db:seed --class=CustomerSeeder --no-interaction`), hanya pada local/testing dengan POS_DEMO_MODE=true. Menambahkan satu pelanggan contoh tanpa menimpa perubahan atau mengaktifkan kembali pelanggan yang telah diarsipkan; DatabaseSeeder juga memanggilnya.

## Pengaturan toko, pajak, dan struk

**Pengaturan** hanya tersedia untuk owner:

- **Profil toko:** nama, alamat, telepon, dan email toko untuk struk.
- **Pajak penjualan:** aktif/nonaktif, tarif 0–100% dengan maksimal dua desimal. Nonaktif menghasilkan pajak nol di POS dan server, sambil menyimpan tarif untuk diaktifkan kembali. Tanpa setting tax_enabled, perilaku lama tetap aktif. Pajak dihitung sesudah diskon. Nilai pajak dan total transaksi lama tidak berubah.
- **Template struk:** teks header/footer multiline (masing-masing maksimal 500 karakter), kertas 58/80 mm, tampilkan/sembunyikan kasir/pelanggan/SKU, dan dialog cetak otomatis. Template berupa teks aman, bukan Blade/HTML yang dieksekusi. Rincian pembayaran serta status selalu tampil.
- **Pratinjau struk:** tab baru memakai isian saat ini dengan contoh transaksi, tanpa menyimpan pengaturan atau membuat penjualan. Tampilan memakai template yang sama dengan cetak transaksi. Ukuran kertas printer tetap dipilih pada dialog cetak browser.
- **Koneksi internet:** pemeriksaan manual dari server POS ke HTTPS `https://www.gstatic.com/generate_204`, timeout koneksi 2 detik/total 4 detik, tanpa redirect, maksimal 10 kali/menit. Hanya HTTP 204 dianggap berhasil; portal WiFi, timeout, atau error tidak dianggap online. Bila layanan pemeriksaan diblokir, hasil gagal tidak membuktikan seluruh internet terputus. Indikator jaringan browser ditampilkan terpisah sebagai perkiraan. Fitur ini tidak menyediakan checkout offline.
- **Tampilan & akses:** ganti tema per perangkat serta tautan manajemen pengguna dan audit. Perubahan pelanggan dan pengaturan dicatat pada audit.

Header/footer dan opsi tampilan saat mencetak mengikuti pengaturan terbaru. Item, nama pelanggan, pajak, nominal, dan status mengikuti snapshot transaksi.

## Inventori bahan baku

Menu **Inventori & resep** tersedia untuk Owner dan Admin dengan izin katalog. Kasir tetap bisa checkout, tanpa akses mengubah bahan, resep, atau mutasi manual.

1. Tambahkan satuan dasar pada **Satuan dasar**, misalnya gram (g), mililiter (ml), dan buah (pcs).
2. Tambahkan bahan dengan SKU unik, satuan dasar, stok minimum, dan status aktif. Saldo awal nol; stok tidak dapat diedit langsung. Satuan bahan yang sudah dibuat tidak dapat diganti.
3. Pilih **Mutasi** pada bahan untuk mencatat stok masuk atau penyesuaian tambah/kurang. Alasan wajib; stok masuk juga membutuhkan referensi penerimaan. Penyesuaian memakai jumlah selisih, bukan saldo akhir. Mutasi yang membuat stok negatif ditolak.
4. Tambahkan resep produk atau varian. Takaran adalah kebutuhan per satu item terjual, dalam satuan dasar. Resep varian menggantikan seluruh resep produk. Bila resep varian nonaktif, resep produk aktif menjadi fallback.
5. Checkout seperti biasa. Stok minimum, riwayat mutasi, dan laporan pemakaian tersedia dari menu inventori.

Kuantitas disimpan sebagai DECIMAL(15,3), dihitung memakai integer perseribu, dengan batas aplikasi 999999999.999 satuan. Takaran resep maksimal 999999.999 per bahan/porsi. Konversi satuan pembelian dilakukan sebelum input, misalnya 1 kg = 1000 g; konversi otomatis belum tersedia.

### Integritas checkout dan pembayaran

- Checkout membuat snapshot resep pada sale_item_ingredients. Pemakaian mencantumkan ingredient_id, recipe_id, sale_item_id, sale_id, invoice, pengguna yang memproses, serta snapshot nama bahan, satuan, dan takaran.
- Pembayaran tunai atau QRIS/transfer yang langsung dikonfirmasi memotong stok dalam transaksi database yang sama dengan sale, item, payment, dan audit. Bahan dikunci memakai SELECT FOR UPDATE dalam urutan ID, lalu seluruh kebutuhan bahan diperiksa bersama. Kekurangan satu bahan membatalkan seluruh checkout.
- Pembayaran menunggu **belum mengurangi atau mereservasi stok**. Konfirmasi lunas memakai snapshot resep saat checkout. Bila stok saat konfirmasi tidak cukup, pembayaran tetap menunggu; saldo, payment, dan audit konfirmasi di-rollback.
- Perubahan resep sesudah checkout tidak mengubah kebutuhan pesanan menunggu. Pengulangan checkout memakai idempotency key lama; inventory_deducted_at dan unique(sale_item_id, ingredient_id) mencegah pemotongan ganda. Mutasi manual juga memakai UUID idempotensi.
- Produk tanpa resep aktif tetap dapat dijual tanpa pengurangan bahan agar katalog lama tetap berjalan. Resep aktif kosong atau bahan nonaktif memblokir checkout. Pastikan semua produk yang perlu stok sudah mempunyai resep.
- Riwayat mutasi tidak memiliki endpoint edit/hapus. Koreksi dilakukan melalui penyesuaian baru dengan alasan. Penghapusan bahan memakai arsip dan ditolak bila masih berstok, dipakai resep, atau diperlukan pesanan menunggu. Simbol satuan yang sudah dipakai tidak dapat diubah.
- Peringatan stok minimum tampil pada daftar bahan saat saldo <= minimum. Laporan pemakaian menghitung mutasi penjualan lunas berdasarkan tanggal mutasi, dengan filter bahan dan tanggal; stok masuk/penyesuaian tidak masuk laporan pemakaian. Nama/satuan laporan mengikuti snapshot histori.

### Upgrade dan data demo inventori

Migration bersifat tambahan; tidak melakukan backfill atau pemotongan stok untuk transaksi lama. Pada database development yang sudah diperiksa:

~~~powershell
& '..\.tools\php\php.exe' artisan migrate --no-interaction
# Opsional: hanya menambahkan demo inventori; akun owner demo harus sudah ada.
& '..\.tools\php\php.exe' artisan db:seed --class=InventorySeeder --no-interaction
~~~

InventorySeeder hanya berjalan dengan APP_ENV=local/testing dan POS_DEMO_MODE=true. Menambahkan satuan g/ml/pcs, delapan bahan dengan saldo awal simulasi, resep minuman dan kopi kemasan, serta resep Iced dengan es batu. DatabaseSeeder memanggilnya setelah membuat penjualan contoh. Seeder hanya memberi saldo awal pada bahan demo yang baru dibuat; bahan, saldo, resep, dan status yang sudah ada tidak ditimpa. Transaksi lama tidak dipotong ulang.

### Test MySQL dan konkurensi

Gunakan **database testing terpisah**, bukan database operasional. Test suite memakai migrate:fresh pada target testing. Pada PowerShell, sesuaikan kredensial environment proses:

~~~powershell
$env:DB_CONNECTION = 'mysql'
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '3306'
$env:DB_DATABASE = 'suwanting_inventory_test'
$env:DB_USERNAME = 'akun-testing'
$env:DB_PASSWORD = 'password-testing'
$env:DB_URL = ''
$env:POS_MYSQL_CONCURRENCY = '1'
& '..\.tools\php\php.exe' artisan test --compact
~~~

InventoryConcurrencyTest hanya berjalan pada MySQL dengan POS_MYSQL_CONCURRENCY=1 dan nama database berakhiran _test. Test menjalankan dua proses checkout sungguhan dengan bahan terkunci: dua kasir berebut stok dan dua checkout identik. SQLite tidak menyediakan row lock MySQL; kedua test tersebut dilewati pada SQLite.

Tes inventori lainnya mencakup CRUD dan izin, presisi takaran, batas saldo, idempotensi mutasi, rollback setelah stok sempat ditulis, stok kurang dari kebutuhan gabungan, snapshot resep pembayaran menunggu, fallback varian, audit, escaping HTML, stok minimum, filter laporan, serta seeder yang aman diulang.

## Struktur kode

- app/Http/Controllers: HTTP dan koordinasi halaman.
- app/Http/Requests: validasi dan otorisasi input.
- app/Http/Middleware: status aktif dan role.
- app/Services: CheckoutService, PaymentService, Money, AuditService, InventoryService, RecipeService, InventoryQuantity.
- app/Models: relasi dan casts Eloquent.
- database/migrations: users/akses, categories, products, variants, customers, sales, sale_items, payments, audit_logs, settings, inventory_units, ingredients, recipes, recipe_items, sale_item_ingredients, stock_movements; foreign keys, index, DECIMAL dan unique constraint.
- database/seeders: demo yang aman dijalankan ulang.
- resources/views/components: button, input, select, modal, badge, empty state, table, toast; pagination memakai komponen Laravel.
- resources/css dan resources/js: token tema, responsivitas, Alpine cart, konfirmasi dan loading.
- tests: test HTTP/domain menggunakan SQLite in-memory; test konkurensi MySQL tersedia untuk verifikasi row lock pada database testing terpisah.

## Pengujian dan build

~~~powershell
php artisan test --compact
php vendor/bin/pint --format agent
npm.cmd run build
~~~

Pada workspace ini ganti php dengan & '..\.tools\php\php.exe'. Gunakan Pint --dirty untuk memformat file yang berubah di Git, atau jalankan tanpa --dirty untuk seluruh file PHP.

Test menguji login, role/izin, CRUD katalog dan inventori, satuan, resep produk/varian, stok masuk/penyesuaian, validasi kuantitas/harga/diskon/pembayaran, rollback, snapshot resep, stok minimum, laporan pemakaian, varian, invoice/idempotensi, scope riwayat, kalkulasi pajak/kembalian, audit tanpa password, escaping HTML, dan seeder idempotent. Test tidak menggunakan database development; target MySQL testing dibatasi ke database berakhiran `_test`.

CustomerAndSettingsTest mencakup akses pelanggan, validasi/arsip/audit, pencarian minimal, pelanggan opsional/terdaftar saat checkout, snapshot nama dan retry sesudah arsip, pajak on/off, format struk dan pratinjau tanpa write, escaping, serta pemeriksaan internet dengan respons sukses, jaringan gagal, portal WiFi, redirect, dan error layanan yang di-fake. Pemeriksaan UI juga dilakukan pada browser lokal untuk navigasi mobile, pencarian/pemilihan pelanggan, konfirmasi keranjang, dark mode, dan pratinjau struk.

## Batasan dan fondasi tahap berikutnya

Supplier, pembelian, cashflow, pengeluaran, shift, refund, dan integrasi gateway belum diimplementasikan. Tidak ada tombol palsu untuk modul tersebut. Menambah item ke keranjang tidak mengubah stok.

Ekstensi berikutnya dapat menambahkan purchases dan supplier dengan referensi ke stock_movements, shift_id nullable pada sales, serta refunds/payments bertaut ke sale. Snapshot sale_items, sale_item_ingredients, dan audit tetap menjadi histori. Jangan mengganti snapshot dengan join harga atau resep terbaru.

Gunakan public/ sebagai document root, APP_ENV=production, APP_DEBUG=false, HTTPS, SESSION_SECURE_COOKIE=true, kredensial database terbatas, dan backup database pada deployment. Pembayaran simulasi bukan verifikasi transfer nyata.
