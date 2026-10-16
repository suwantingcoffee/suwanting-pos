# Hasil pengujian Supabase, produk, dan inventori

Dijalankan ulang 17 Oktober 2026 pada Windows, Node.js v24.22.0, PGlite 0.3.14
(PostgreSQL 17.5), PostgreSQL native 18.4 sementara, dan Chrome headless. Tes PGlite
membuat database di memori; tes konkurensi membuat cluster khusus di workspace
dan membersihkannya sesudah shutdown. Tidak ada migration, reset, seed, atau
perubahan lain pada database remote maupun situs Beta.

| Pemeriksaan | Hasil aktual |
| --- | --- |
| `npm test` | **67 lulus, 0 gagal, 0 dilewati**, termasuk alur gabungan produk → stok → shift → penjualan → jurnal → laporan → rekonsiliasi |
| `npm run test:concurrency` | **1 lulus**, beberapa koneksi PostgreSQL native, termasuk dua kasir berbeda yang menjual stok terakhir bersamaan, request duplikat, refund, dan withdrawal stok |
| `npm run test:ui` | **19 lulus**, Chrome headless/API tiruan, termasuk laporan, ekspor CSV, sesi kedaluwarsa, empty/error states, viewport HP/tablet/desktop, dan modal kasir HP |
| 18 migration SQL terurut (001-018) | Berhasil dari database baru |
| Forward migration 007–013 pada database berisi data | Saldo, unit, movement lama dan tabel lain tetap utuh; installer non-superuser |
| Instalasi oleh non-superuser CREATEROLE pemilik database | Lulus, termasuk seluruh fixture operasi dan finance |
| RLS | 48 tabel memakai ENABLE dan FORCE RLS |
| Batas migration 001/002 sebelum policy lengkap | Akses API sudah ditutup, termasuk dengan default grants Supabase yang luas |
| `npm run types` | 48 tipe tabel dan 44 tipe RPC dihasilkan dari katalog database |
| `npm --prefix frontend run build` | ESLint, TypeScript strict, dan production Vite build lulus |
| `supabase/preflight.sql` | Berhasil sebagai transaksi read-only pada database tes |
| `npm run test:supabase` | **1 suite dilewati**, key/stack Supabase lokal belum tersedia |

Tes native dan browser berhasil selesai dengan exit code 0 di luar sandbox.
Percobaan native di sandbox gagal pada pembacaan identitas Windows
(`uv_os_get_passwd`); percobaan browser di sandbox tertahan saat cleanup server.
Keduanya dijalankan ulang tanpa mengubah assertion atau melewati skenario.

Satu percobaan UI mengalami tiga timeout saat server dev lambat. Pengulangan seluruh 11 skenario dengan assertion yang sama lulus dalam 48,2 detik. Stack Supabase penuh belum dijalankan: Docker/Supabase CLI tidak tersedia di PATH dan public key tes belum dikonfigurasi.

## Identitas dan skenario

Fixture berisi dua organisasi, tiga outlet, semua enam role (`owner`, `admin`,
`manager`, `cashier`, `inventory_staff`, `finance_staff`), owner organisasi kedua,
outsider, dan anggota nonaktif. Semua tabel tenant memiliki data fixture; tes
isolasi memeriksa keberadaan baris sebelum menguji penolakan baca organisasi lain.
Sesi SQL memakai role `authenticated`/`anon` dan identitas pengguna yang berbeda.

Skenario yang lulus:

- Organisasi B tidak dapat membaca data A pada seluruh tabel tenant, organisasi,
  atau profil; INSERT master A ditolak dan UPDATE master A tidak mengubah baris.
- Anonymous, outsider dan membership nonaktif tidak mendapat akses bisnis.
  Metadata signup/JWT `user_metadata` dengan role owner tidak memberikan izin.
- Foreign key gabungan menolak parent lintas organisasi; tenant, outlet, ID,
  dan waktu pembuatan tidak bisa dipindahkan melalui UPDATE.
- Batas outlet ditegakkan pada pembacaan dan RPC. Admin/kasir/stok/finance tidak
  dapat menaikkan role sendiri; owner aktif terakhir tidak dapat dihilangkan.
- Penulisan langsung ke audit, jurnal, ledger, pembayaran, order, dan dokumen
  sensitif ditolak termasuk bagi pengguna aplikasi ber-role owner.
- Harga checkout berasal dari katalog. Harga kiriman frontend, input invalid,
  jumlah negatif/terlalu presisi, variant organisasi lain dan stok kurang ditolak.
  Kegagalan mengembalikan transaksi utuh; retry idempotensi tidak menduplikasi
  pembayaran maupun stok.
- Refund tidak melebihi pembayaran; retry identik tidak menggandakan refund
  dan payload berbeda, termasuk NULL, ditolak. Retry penerimaan PO tidak
  menggandakan stok; produksi dan waste menghasilkan saldo yang sesuai ledger.
- CRUD kategori, produk/varian dan supplier memvalidasi kepemilikan, SKU/barcode
  unik, URL foto HTTPS dan arsip. Penyimpanan produk beserta varian gagal secara
  atomik; arsip produk yang masih memiliki stok ditolak.
- Konversi kg/g dan l/ml menghasilkan jumlah dan nilai yang sesuai; unit berbeda
  dimensi, presisi berlebih, angka non-finite dan perubahan faktor ditolak.
  Transfer menjaga jumlah/nilai sumber dan tujuan, serta memerlukan akses kedua
  outlet. Opname memeriksa revisi dan menerima hitungan nol tanpa stok negatif.
- Penerimaan PO mengonversi unit pembelian, mempertahankan biaya historis dan
  menolak PO belum approved. Roasting memakai konsumsi/yield aktual, membawa biaya
  bahan ke hasil dan mencatat waste. Stok kurang membatalkan operasi seluruhnya.
- Checkout menu mode resep mengurangi bahan sekali, menyimpan versi/biaya konsumsi
  dan tidak memotong stok menu lagi. Perubahan resep mempertahankan snapshot
  transaksi selesai; menu mode stok hanya mengurangi produk jadi sesuai ukuran.
- Pencarian nama/SKU/barcode dan saldo memakai pagination server dengan count.
  Ekspor CSV mengambil seluruh halaman, melindungi formula spreadsheet, dan
  melaporkan kegagalan pengambilan halaman. Semua foreign key tenant memiliki
  indeks; policy installer sementara tidak tertinggal sesudah migration.
- Semua jurnal fixture berimbang dan memiliki minimal dua baris. Posting tidak
  berimbang ditolak oleh RPC dan constraint deferred pada COMMIT; jurnal final
  tidak dapat dimutasi oleh role penulis internal.
- Pengeluaran, pemasukan, modal, pembelian aset, pinjaman dan cicilan memakai
  idempotency key; aset bukan beban operasional, pokok/bunga/biaya pinjaman
  memakai akun terpisah, dan jurnal refund/reversal tidak diduplikasi.
- Rekonsiliasi shift tertutup menghasilkan selisih dan adjustment satu kali;
  reversal jurnal memerlukan role approver, menjaga debit/kredit seimbang, dan
  menolak reversal kedua.
- Actor audit berasal dari identitas Auth; pencabutan membership berlaku pada
  request berikutnya tanpa mengandalkan refresh role di frontend.
- Role pemilik fungsi NOLOGIN/NOBYPASSRLS, tanpa SUPERUSER/CREATEROLE;
  SECURITY DEFINER memakai search_path kosong. Hak INHERIT/SET sementara installer
  dicabut, sesi browser tidak mendapat membership internal.
- Angka non-finite dan nama kosong ditolak; seed memerlukan opt-in development,
  dapat diulang tanpa menimpa data, dan arsip outlet mempertahankan akses riwayat
  sambil menolak transaksi baru. Tabel lama yang tidak terkait tetap utuh.
- Validator klien menolak server secrets/URL tidak aman; modul API mengirim
  payload dan UUID idempotensi yang sama, meneruskan error izin/database/jaringan,
  serta tidak diam-diam mengulang checkout saat jaringan gagal. Respons HTTP untuk
  tes modul frontend memakai fetch tiruan, bukan koneksi Supabase hosted.

Tes PostgreSQL native memakai koneksi terpisah dengan role `authenticated` dan
identitas pengguna fixture. Dua pengeluaran stok terakhir dan dua checkout hanya
mengizinkan satu pemenang; request stok identik dan penerimaan PO bersamaan
menghasilkan satu operasi. Saldo akhir direkonsiliasi dengan jumlah movement dan
saldo seluruh lokasi.

Browser memeriksa validasi/loading/sukses formulir produk, retry opname dengan
key/revisi sama, konfirmasi lokasi penerimaan, input/yield produksi aktual,
katalog kasir baca saja, tampilan mobile, tambah/arsip/pulihkan pelanggan, dan
hak baca pelanggan berdasarkan role, dashboard keuangan dan pengiriman
pengeluaran ke RPC aktual. Reporting diperiksa pada viewport 390×844, 768×1024,
dan 1440×900; modal produk dan pembayaran diuji di 390×844. Tes Auth memastikan
sesi yang kedaluwarsa kembali ke login. Error RPC database ditampilkan dan dapat
dicoba ulang; state kosong tidak menyajikan data transaksi. Respons Auth/API tiruan
pada tes browser menguji perilaku UI; otorisasi database diuji melalui sesi SQL
beberapa pengguna di suite terpisah.

Tes alur terintegrasi database membuat produk/varian, memasukkan stok, membuka
shift, memfinalisasi pembayaran tunai, lalu memeriksa saldo stok, kembalian,
jurnal pembayaran seimbang, angka RPC laporan, penutupan shift, serta hasil
rekonsiliasi kas. Ini berjalan pada PGlite, bukan melalui browser yang tersambung
ke gateway Supabase.

## POS tambahan

- Harga, promo, pajak outlet, kembalian dan snapshot berasal dari server; hold tidak memotong stok.
- Split tunai/QRIS: pending, partial, paid/failed terpisah dari status order; settlement memerlukan role finance/manager ke atas dan referensi sebenarnya.
- Stok kurang menggulung balik finalisasi tunai termasuk payment, kas, jurnal, dan konsumsi. Settlement elektronik yang sudah nyata tetap tersimpan bila fulfillment kemudian gagal.
- Retry order/finalisasi/refund tidak menggandakan efek; race payment allocation/refund dibatasi.
- Refund bertahap membalik pajak tepat sampai nominal asli; settlement terlambat setelah refund menjaga status yang benar.
- Resep yang diubah setelah hold tidak mengubah rencana konsumsi tersimpan; satuan kg/g dan biaya historis tetap konsisten.
- Legacy checkout dibatasi tunai tanpa pajak, tidak dapat melewati verifikasi elektronik atau pajak outlet.
- Migration 014-017 mempertahankan sale/refund/item/stock/jurnal legacy pada database berisi data dengan installer non-superuser.
- Browser menguji checkout, keranjang mobile, hold/resume, split, settlement manual, print struk, retry yang dipulihkan, konfirmasi void/refund, dan filter WIB. Respons API browser tetap tiruan.

## Batas hasil ini

Tes PGlite menggunakan Auth minimal khusus harness. Tes installer memodelkan hak
database/schema/Auth yang diperlukan, bukan seluruh konfigurasi Supabase hosted.
PGlite memiliki bug pada GRANT terhadap database template1; harness installer
menggunakan kepemilikan database untuk memodelkan installer non-superuser.
PostgreSQL 17 dapat mempertahankan membership ADMIN pembuat role tanpa INHERIT/SET;
installer tetap administrator yang dipercaya, bukan identitas aplikasi.

Konkurensi multi-koneksi sudah diuji pada PostgreSQL native 18.4 sementara;
konfigurasi stack Supabase lokal menargetkan PostgreSQL 17 dan belum dijalankan.
Auth GoTrue, verifikasi JWT melalui gateway, PostgREST, pooling, dan konfigurasi hosted
**belum diverifikasi pada stack Supabase sebenarnya**. Suite HTTP lokal tersedia
untuk seluruh role, isolasi tenant, checkout bersamaan dengan key identik dan
perebutan stok terakhir. Pada run ini suite dilewati karena
`SUPABASE_TEST_PUBLISHABLE_KEY` belum diisi; stack lokal belum dikonfigurasi.
Hasil skip bukan hasil lulus.

Workspace ini tidak memiliki metadata Git, sehingga pemeriksaan `git diff`
terhadap baseline tidak tersedia. Pemeriksaan akhir mencakup source, daftar
migration, dokumentasi, generator tipe, pengujian dan build yang tercatat di atas.

Sebelum rilis, jalankan langkah Supabase lokal di [SUPABASE.md](SUPABASE.md), isi
`SUPABASE_TEST_PUBLISHABLE_KEY`, dan jalankan `npm run test:supabase` sampai seluruh
subtes lulus. Kemudian verifikasi di staging beserta backup/restore. Keberhasilan
login atau suite sementara ini tidak diperlakukan sebagai bukti keamanan selesai.
