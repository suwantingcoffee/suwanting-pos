# Suwanting Coffee POS

POS statis untuk GitHub Pages: Vite 8, Alpine.js 3, Tailwind CSS 4, Lucide, Poppins, warna #F28500, serta light/dark mode dan tata letak mobile. Supabase menangani Auth, PostgreSQL, RPC transaksi, dan foto privat. Tidak membutuhkan Laravel, PHP, Composer, atau server Node pada hosting.

Versi Laravel tersimpan di branch `backup/laravel-20261020`. Database/file lokal lama tidak dihapus. Data operasional Laravel/React **tidak otomatis dipindahkan**; aplikasi ini memakai schema terpisah `suwanting_pos`, tanpa mengubah tabel aplikasi lain. Migrasi data lama memerlukan pemetaan dan verifikasi tersendiri.

## Menjalankan

Pasang Node.js 22.12+ (disarankan 24), lalu dari folder ini:

```powershell
npm.cmd ci
npm.cmd run dev
```

Buka http://127.0.0.1:5173/. Alternatif Windows: `./run.cmd`, atau `./run.cmd 5174` untuk port lain. Launcher memakai Node/Vite. Jangan membuka `index.html` sebagai `file://` atau memakai `public/index.php` lama.

```powershell
npm.cmd run build
npm.cmd run preview
```

Hasil build ada di `dist`, pratinjau di http://127.0.0.1:4173/. Hanya `dist` yang dipublikasikan; file `.env`, database lokal, vendor, test, dan PHP lama tidak disalin ke build. Hash route seperti `#/pos` dan `#/sale/12` mendukung reload pada subpath GitHub Pages.

## Supabase sekali pasang

Konfigurasi publik sudah menunjuk proyek `https://scfvibqjzlflbbpnrdjv.supabase.co`. Bisa diganti melalui Konfigurasi koneksi di halaman login atau variabel `.env.local` sesuai `.env.example`. Build hanya menggunakan variabel `VITE_*` yang dirujuk kode.

**Jangan masukkan secret/service_role key atau password database ke frontend, Git, atau `VITE_*`.** Publishable/anon key memang boleh berada di browser; otorisasi tetap diperiksa di database.

1. Untuk proyek kosong, jalankan file SQL di `supabase/migrations` sesuai urutan nama. Alternatif setelah build: jalankan seluruh `dist/setup.sql` sekali. Script membuat schema baru dan sengaja gagal bila sudah terpasang agar tidak menimpa data.
2. Untuk instalasi lama, jalankan hanya file pembaruan yang belum terpasang sesuai urutan: `20261020000200_product_details.sql` (versi 2), lalu `20261021000300_account_branding_product_types.sql` (versi 3). Jangan ulangi setup awal atau migration yang sudah terpasang. Versi 3 menambah akun, logo, jenis produk, SKU otomatis, dan hapus master data dengan pemeriksaan relasi; data operasional tetap tersimpan.
3. Supabase → Authentication → Users → Add user. Buat akun owner dengan email/password pribadi dan konfirmasi email. Akun baru otomatis menjadi kasir nonaktif; metadata signup tidak bisa memberi role owner.
4. Aktifkan owner pertama dari SQL Editor, ganti email berikut:

```sql
update suwanting_pos.profiles
set role = 'owner', is_active = true
where lower(email) = lower('email-owner@toko.com')
returning email, role, is_active;
```

5. Masuk ke aplikasi. Owner dapat menambah kategori/produk, bahan, resep, pelanggan, dan mencatat stok awal. Tombol **Isi katalog simulasi** pada Pengaturan hanya bekerja saat produk/bahan kosong dan selalu meminta konfirmasi.
6. Authentication → URL Configuration: set Site URL ke `https://suwantingcoffee.github.io/suwanting-pos/`. Tambahkan Redirect URL `https://suwantingcoffee.github.io/suwanting-pos/?recovery=1` dan URL lokal yang dipakai, misalnya `http://127.0.0.1:5173/?recovery=1`, untuk pemulihan password.

Jangan expose schema `suwanting_pos` melalui Data API. Aplikasi memakai fungsi `public.scpos_*`. Semua tabel memakai RLS tanpa grant langsung ke anon/authenticated. Fungsi status publik hanya mengembalikan versi/waktu/status kesiapan owner. Semua fungsi data membutuhkan akun aktif dan izin sesuai role.

Script juga membuat bucket privat `scpos-products` dan policy Storage; upload hanya JPEG/PNG/WebP ≤2 MB oleh pengguna berizin katalog. URL foto bertanda tangan berlaku satu jam; membuka ulang Kasir memuat URL baru. Google Fonts membutuhkan akses internet; fallback font sistem tersedia.

## Pengelolaan akun Supabase

Role/status/izin pengguna yang sudah terdaftar bisa diedit langsung melalui RPC. Pembuatan akun Auth dan perubahan email/password membutuhkan Edge Function `scpos-create-user` yang tersedia di repositori. Tanpa function tersebut, dashboard/POS/inventori/pelanggan/pengaturan tetap berjalan; operasi Auth itu menampilkan error yang jelas.

Dari folder proyek, menggunakan Supabase CLI yang sudah login ke akun pemilik proyek:

```powershell
npm.cmd exec --yes --ignore-scripts=false --package=supabase -- supabase login
npm.cmd exec --yes --ignore-scripts=false --package=supabase -- supabase functions deploy scpos-create-user --project-ref scfvibqjzlflbbpnrdjv --use-api
```

`supabase/config.toml` menonaktifkan verifikasi JWT gateway untuk function ini karena handler sendiri memverifikasi bearer token ke Supabase Auth, kemudian membaca role owner aktif dari database. Menonaktifkan pemeriksaan gateway tidak membuat endpoint menjadi anonim.

Runtime function memakai `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` bawaan server Supabase. Service key dipakai **hanya di function**, tidak dikirim ke browser. Origin bawaan: `https://suwantingcoffee.github.io`, `http://127.0.0.1:5173`, dan `http://localhost:5173`. Untuk domain/port lain atur secret server `ALLOWED_ORIGINS` berupa daftar origin dipisahkan koma, tanpa path.

Auth Admin API dan RPC tidak berbagi satu transaksi database. Jika pembuatan profil gagal, handler mencoba membatalkan akun Auth; bila pembatalan ditolak karena referensi data, UI meminta memeriksa akun yang mungkin sudah terbentuk. Jika perubahan Auth gagal setelah role tersimpan, UI menyebut perubahan izin yang sudah tersimpan. Periksa Pengguna/Authentication sebelum mengulang. Password tidak ditulis ke profil/audit aplikasi.

Untuk produksi, atur kebijakan password, email recovery/SMTP, pembatasan login dan CAPTCHA di Supabase Auth. Gunakan akun pribadi, bukan akun latihan bersama. Owner tidak dapat menonaktifkan atau menurunkan role sendiri.

## GitHub Pages

Workflow `.github/workflows/pages.yml` menjalankan tes, build, dan tes browser sebelum deploy `dist` dari `main`.

1. Push versi statis ke `main` repo `suwantingcoffee/suwanting-pos`.
2. GitHub → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Buka tab Actions, tunggu workflow **Test and deploy Suwanting POS** berhasil. Jika perlu, jalankan lewat Run workflow pada branch `main`.
4. Buka https://suwantingcoffee.github.io/suwanting-pos/.

Tidak ada PHP/MySQL di GitHub Pages. Database sekarang PostgreSQL di Supabase; perangkat kasir harus online. Konfigurasi proyek publik sudah ada di kode sehingga workflow tidak memerlukan secret database. Akun dan data toko tidak disimpan di GitHub.

## Fitur

- Dashboard penjualan lunas, transaksi menunggu, grafik tujuh hari, metode pembayaran, menu aktif, dan peringatan stok minimum.
- POS: pencarian/kategori, varian, kuantitas/catatan, diskon berizin, pajak, tunai/kembalian, QRIS/transfer simulasi, pemeriksaan pesanan, detail/struk cetak.
- Pelanggan CRUD/arsip dan pencarian nama/telepon. Checkout tetap opsional: pelanggan umum, nama/meja bebas, atau pelanggan terdaftar. Nama disimpan sebagai snapshot transaksi.
- Kategori, jenis produk, dan produk CRUD/arsip, harga jual/modal, deskripsi, foto, varian, status aktif. Jenis bawaan Minuman, Kopi kemasan, dan Makanan tetap tersedia; jenis baru bisa dibuat sendiri. Nama/kode jenis bisa diubah tanpa memutus relasi produk.
- Ikon profil kanan atas membuka **Akun saya** untuk semua akun aktif: nama, telepon, foto privat, dan ganti password dengan verifikasi password saat ini. Email/role/izin tetap dikelola owner melalui Pengguna.
- Upload/ganti/hapus logo di Pengaturan ? Logo web & toko. Logo publik tampil di login, navigasi, dan favicon; PNG transparan atau gambar persegi disarankan. Foto/logo menerima JPG, PNG, WebP maksimal 2 MB. Upload avatar hanya ke folder akun sendiri; upload logo hanya owner.
- Satuan dasar, bahan dengan minimum stok, resep produk/varian, stok masuk, penyesuaian tambah/kurang dengan alasan dan referensi, riwayat, serta laporan pemakaian bahan dengan filter tanggal/bahan.
- Pengaturan profil toko, sakelar pajak/tarif, template struk teks aman, lebar kertas 58/80 mm, tampilkan kasir/pelanggan/SKU, cetak otomatis, pratinjau tanpa transaksi, dan pemeriksaan koneksi perangkat ke Supabase dengan timeout empat detik.
- Pengguna/izin, laporan penjualan lunas, audit sebelum/sesudah, ekspor CSV dengan perlindungan formula spreadsheet. Ekspor laporan produk mengikuti maksimal 30 produk terlaris yang ditampilkan.

| Akses | Owner | Admin | Kasir |
| --- | --- | --- | --- |
| Kasir dan cari pelanggan aktif | Ya | Ya | Ya |
| Transaksi/struk | Semua | Semua | Milik sendiri |
| Kelola pelanggan | Ya | Ya | Tidak |
| Katalog/inventori | Ya | Sesuai izin katalog | Tidak |
| Diskon | Ya | Sesuai izin diskon | Tidak |
| Pengguna/pengaturan/laporan/audit | Ya | Tidak | Tidak |

## SKU dan penghapusan data

Produk dan bahan baru mendapat SKU dari tiga karakter alfanumerik pertama nama, misalnya `Americano` ? `AME-001` dan `Americano Lemonade` ? `AME-002`. Awalan pendek dilengkapi `X`; nama tanpa karakter Latin memakai `PRD`/`BHN`. Angka mengikuti nomor terkecil yang belum dipakai, diperpanjang setelah 999. Produk dan varian berbagi ruang SKU; bahan memakai ruang tersendiri. SKU tersimpan dinormalisasi huruf besar.

Isian otomatis tetap bisa diedit; tombol **SKU otomatis** mengaktifkan kembali saran. Saran belum memesan nomor: server menentukan ulang SKU otomatis saat menyimpan di dalam lock katalog, sehingga dua akun bersamaan tidak mendapat nomor sama. Edit produk lama mempertahankan SKU. SKU produk/varian/bahan yang diarsipkan tetap dihitung terpakai.

Tombol **Hapus** tersedia untuk kategori, jenis produk, produk, pelanggan, satuan, bahan, dan resep. Dialog meminta konfirmasi. Hapus permanen hanya untuk data tanpa relasi yang menghalangi. Produk dengan transaksi/resep, pelanggan dengan transaksi, bahan dengan stok/mutasi/resep, resep dengan pemakaian, serta kategori/jenis/satuan yang masih dirujuk akan ditolak dengan alasan. **Arsipkan** mempertahankan histori. Menghapus produk kosong juga menghapus varian yang belum dipakai. Akun pengguna dinonaktifkan melalui Edit; transaksi lunas, mutasi, dan audit tidak dapat dihapus. Semua hapus/arsip tercatat bersama pengguna dan data sebelumnya.

## Integritas stok dan pembayaran

Harga/varian, total, pajak dan izin dihitung ulang di PostgreSQL. Uang memakai `numeric(12,2)`, stok `numeric(15,3)`. Satuan bahan tetap setelah dibuat; konversi pembelian dilakukan sebelum input, misalnya 1 kg = 1000 g. Takaran resep per satu produk memakai satuan dasar. Resep varian aktif menggantikan resep produk; resep produk aktif menjadi fallback. Produk tanpa resep aktif tetap bisa dijual tanpa potongan bahan.

Checkout menyimpan snapshot item, harga, pelanggan dan resep. Sale, pemakaian, saldo, mutasi dan audit berada dalam satu transaksi RPC. Lock bahan diambil berdasarkan ID; kebutuhan gabungan diperiksa sebelum pemotongan. Kekurangan satu bahan atau error penulisan membatalkan seluruh transaksi. Lock katalog menghindari perubahan resep di tengah checkout.

UUID idempotensi dan hash payload mengikat checkout ke akun dan data pesanan. Pengulangan identik mengembalikan invoice sebelumnya, termasuk setelah pelanggan diarsipkan. UUID yang dipakai ulang dengan payload/pengguna lain ditolak. Mutasi manual juga idempoten dan tidak bisa membuat stok negatif.

Saat respons jaringan belum pasti, frontend menyimpan payload immutable di `sessionStorage` per akun dan mengunci perubahan pesanan. Reload tab dapat memulihkan permintaan; **Ulangi checkout** memakai UUID/payload yang sama. Jangan hapus penyimpanan atau tutup tab ketika hasil belum pasti; periksa riwayat transaksi sebelum membuat pesanan baru. Keranjang yang belum pernah dikirim masih berada di memori. Ini bukan mode offline dan tidak menyinkronkan pesanan antartab/perangkat.

QRIS/transfer diberi label **simulasi**; belum terhubung gateway bank. Pembayaran menunggu tidak mengurangi/mereservasi stok. Konfirmasi simulasi memakai resep snapshot awal dan hanya memotong sekali; stok kurang membuat pembayaran tetap menunggu. Matikan simulasi di Pengaturan untuk membatasi transaksi ke tunai. Transaksi lunas/mutasi historis tidak punya endpoint hapus/edit; koreksi stok dibuat sebagai penyesuaian baru.

Template struk mengikuti pengaturan terbaru; item, pelanggan, nominal dan pajak mengikuti snapshot penjualan. Header/footer dirender sebagai teks, bukan HTML. Pilih ukuran kertas printer yang sesuai melalui dialog cetak browser.

## Pengujian

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
```

Tes database membuat database acak baru, memasang migration yang sama dengan produksi, menguji RPC/izin/konkurensi/rollback, lalu menghapus **hanya database tes tersebut**. Untuk PostgreSQL lokal terpisah (role tes memerlukan izin CREATEDB):

```powershell
$env:TEST_DATABASE_URL = 'postgres://postgres:password-testing@127.0.0.1:5432/suwanting_test'
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:browser
```

Target harus bernama akhir `_test`. Jangan memakai koneksi Supabase operasional. Windows workspace ini juga mempunyai runtime PG native khusus tes di `../.tools/pos-pages-runtime`; test akan memakainya bila `TEST_DATABASE_URL` kosong. Browser Windows memakai Chrome yang terpasang; Linux CI memakai Chromium.

Browser harness menyajikan build pada `/suwanting-pos/`, memakai PostgreSQL/RPC asli dan **test double untuk HTTP Auth**. Tes mencakup subpath/reload, tema, mobile, pelanggan, struk aman dari HTML, pajak, stok/resep, pembatasan kasir dan respons checkout yang hilang setelah commit. Tes Auth, perubahan password, dan transfer file HTTP Storage memakai test double; metadata gambar menguji policy Storage RLS asli di PostgreSQL. Tes tambahan mencakup isolasi foto akun, logo owner, SKU bersamaan/manual, CRUD jenis produk/kategori, dan proteksi relasi saat hapus. Tes Auth Admin memakai test double; konfigurasi email recovery perlu diverifikasi pada proyek tujuan. Tes tidak menyentuh data Supabase operasional.

## Struktur dan batasan

`index.html` adalah entry; `resources/js` berisi Alpine/backend/domain/form schema, `resources/views/static` template HTML, `resources/css` tema, `supabase/migrations` database/RPC/RLS, `supabase/functions` Auth Admin, dan `tests/static` pengujian.

Belum tersedia: gateway pembayaran nyata, checkout/sinkronisasi offline, refund, shift kasir, supplier/pembelian, cashflow/pengeluaran, konversi satuan otomatis, serta migrasi otomatis histori Laravel. Git branch backup mempertahankan implementasi lama untuk referensi/pemulihan.
