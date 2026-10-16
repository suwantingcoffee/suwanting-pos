# Panduan Proyek Suwanting POS

## Hasil audit dan kondisi awal

- Folder ini sebelumnya kosong: belum ada halaman, source code, `package.json`,
  routing, database, atau fitur POS yang dapat dipertahankan maupun dijalankan.
- Sebagai referensi kebutuhan produk saja, sibling `Suwanting Coffe Beta v.1`
  berisi situs statis HTML/CSS/JavaScript: `index.html`, `product.html`, dan
  `admin.html`, tanpa React, TypeScript, Vite, router, atau tes otomatis.
- Situs referensi menyediakan katalog cadangan empat kopi, filter kategori,
  detail produk, pilihan ukuran 100 g–1 kg dan gilingan, keranjang, serta
  checkout melalui WhatsApp. Keranjang memakai `localStorage` key
  `suwanting-cart`, berisi objek berindeks `id|ukuran|gilingan` dengan field
  `id`, `size`, `grind`, dan `qty`.
- Situs referensi juga memiliki edukasi/panduan seduh, FAQ, informasi order,
  placeholder Journey, serta integrasi Supabase opsional untuk produk/konten
  publik, login admin, CRUD, publikasi, dan unggah gambar.
- Skema referensi mendefinisikan `products` dan `site_content` dengan RLS.
  Tidak ditemukan tabel order/transaksi, status pesanan, pembayaran, atau stok.
  Konten Journey masih placeholder dan konfigurasi Supabase frontend berada
  pada source statis.
- Karena POS ini proyek terpisah dan masih kosong, fondasi di sini tidak
  mengubah, memindahkan, atau menggantikan satu pun file proyek referensi.

### Yang sudah berfungsi dan yang belum

- **Di POS ini:** frontend React dan backend Supabase tersedia: 48 tabel,
  migration terurut, RLS, fungsi transaksi, audit/jurnal, tipe database, dan tes
  beberapa pengguna/organisasi. UI produk/inventori sudah terhubung, termasuk
  PO, resep, roasting/produksi, lokasi, CSV, dan autentikasi. UI kasir/transaksi
  sudah terhubung untuk hold/resume, split payment, settlement manual,
  refund/void, dan struk. Pelanggan kini terhubung dengan akses berbasis role
  dan pengarsipan yang mempertahankan transaksi. Keuangan kini terhubung untuk
  pencatatan, jurnal double-entry, rekonsiliasi, dan audit. Dashboard dan laporan
  terhubung ke agregasi Supabase. Pengelolaan pengguna/membership dan pengaturan
  masih placeholder; UI kit juga bukan modul operasional.
- **Di situs referensi:** katalog, detail, keranjang browser, handoff WhatsApp,
  halaman/konten publik, dan admin Supabase adalah fitur yang tersedia untuk
  dipelajari, bukan implementasi POS di folder ini.
- **Belum tersedia pada referensi:** order tersimpan, pembayaran, pelacakan
  order, inventori, akun pelanggan, ongkir terintegrasi, dan harga kemasan
  selain 100 g.
- **Risiko migrasi:** keranjang browser bukan order dan tersimpan per browser;
  belum ada model transaksi atau versi migrasi database; kompatibilitas ID,
  status publikasi, RLS, dan referensi gambar perlu dijaga. Jangan menyamakan
  katalog dengan inventori atau menganggap handoff WhatsApp sebagai checkout
  yang persisten.

## Arsitektur target

- Aplikasi POS baru berada di `frontend/`: React + TypeScript strict + Vite,
  Tailwind CSS, komponen shadcn/ui berbasis source, React Router, Lucide React,
  dan Supabase JS.
- `frontend/src/app.tsx` adalah shell awal; `frontend/src/features/` untuk
  domain POS; `frontend/src/components/` untuk komponen bersama; dan
  `frontend/src/lib/` untuk klien/integrasi, utilitas, serta tipe database.
- `supabase/migrations/` menyimpan baseline POS baru. Jangan menerapkannya pada
  skema Beta atau mereset database berisi data untuk mengatasi collision.
- `frontend/src/lib/database.types.ts` dihasilkan dari migration dengan
  `npm run types` pada root. Jangan mengedit tipe hasil generator secara manual.
  `docs/SUPABASE.md` menjelaskan hak akses, RPC, lingkup, dan prosedur instalasi;
  `docs/TEST_RESULTS.md` mencatat hasil aktual dan pemeriksaan yang belum dijalankan.
- `.env.local` menyimpan konfigurasi Supabase lokal. Produk, inventori, POS,
  keuangan, dashboard, dan laporan menggunakan Supabase; jangan menambahkan
  rahasia server ke bundle/browser.
- `npm test` pada root menguji database sementara dan propagasi error klien.
  `npm run test:supabase` memerlukan stack Supabase lokal dan public key khusus
  tes; hasil skip bukan bukti lulus. Jangan memakai hosted URL untuk fixture tes.
- `npm run test:concurrency` membuat PostgreSQL native sementara di workspace,
  menggunakan port acak localhost, lalu shutdown dan membersihkan direktori run.
  `npm run test:ui` memakai Chrome lokal dengan respons API tiruan. Keduanya
  melengkapi tes PGlite dan tidak menggantikan verifikasi gateway Supabase.
- Migration 007–013 menambahkan model lokasi/biaya/unit, operasi atomik dan UI
  katalog/inventori. Baseline 001–006 tidak diubah. Detail kontrak, mode konsumsi,
  biaya stok warisan dan batas retry ada di `docs/PRODUCTS_INVENTORY.md`.

## Urutan implementasi dan migrasi

1. **Fondasi:** scaffold React/TypeScript/Vite, routing, token Tailwind/shadcn,
   dashboard DEMO, UI kit, state loading/error, dan klien Supabase opsional.
   Belum membangun alur POS atau mengubah data.
2. **Definisi POS:** sepakati aktor, alur kasir, outlet, produk/varian, stok,
   harga, diskon, metode pembayaran, penutupan kas, serta kebutuhan offline.
   Dokumentasikan batas keuangan, privasi, dan model akses.
3. **Model data dan otorisasi:** rancang skema POS/migrasi Supabase terversi,
   constraint/transaksi atomik, RLS, role, audit log, backup, dan strategi
   rekonsiliasi. Tulis tes kebijakan dan migrasi sebelum menyambungkan UI.
4. **Master data:** implementasikan autentikasi berotorisasi, outlet, produk,
   harga, serta inventori sesuai model yang telah disetujui.
5. **Transaksi kasir:** keranjang POS, validasi harga/stok di server, order
   idempoten, pembayaran, pembatalan/refund bila disepakati, dan audit.
6. **Operasional:** riwayat order, laporan/penutupan kas, hak akses, error
   recovery, aksesibilitas, dan pengujian integrasi/end-to-end.
7. **Adopsi data lama (opsional):** hanya jika migrasi dari situs Beta diminta.
   Inventaris sumber dan pemetaan dahulu; ekspor/backup; validasi, dry run,
   ringkasan perubahan, impor idempoten, pemeriksaan hasil, dan rollback.
   Jangan hapus atau menimpa key `suwanting-cart`; jangan konversi cart menjadi
   order, pelanggan, transaksi, atau stok tanpa persetujuan dan konfirmasi.
8. **Rilis:** staging, uji RLS/keuangan, rekonsiliasi, monitoring, persetujuan
   pengguna, backup teruji, dan rencana rollback sebelum produksi.

### Ketentuan migrasi data

- Data lama tetap utuh dan tidak disentuh selama fondasi ini.
- Sumber browser harus dibaca secara read-only saat tahap migrasi; validasi
  JSON, key, ID produk, ukuran, gilingan, dan jumlah, serta tampilkan pratinjau
  sebelum tindakan pengguna.
- Buat backup yang dapat dipulihkan. Migrasi gagal tidak boleh menghapus atau
  menimpa sumber. Tandai migrasi berhasil hanya setelah jumlah dan isi hasil
  diverifikasi.
- Jangan mengimpor data konfigurasi/akun/kredensial lama ke POS. Kunci anon
  publik bukan rahasia; service-role key dan password tidak boleh masuk frontend.

## Aturan coding dan kualitas

- Gunakan TypeScript strict, tipe domain eksplisit, validasi input dan respons
  backend. Hindari `any`, assertion tak berdasar, dan duplikasi model.
- Pisahkan komponen UI, aturan domain POS, dan akses database. Server/database
  tetap sumber kebenaran untuk role, harga, stok, dan status transaksi.
- Jangan menganggap pemeriksaan role di UI sebagai kontrol akses. RLS,
  constraint, dan operasi atomik harus menegakkan otorisasi/integritas.
- Render data remote sebagai teks; jangan memasukkan konten mentah melalui
  `innerHTML`. Laporkan kegagalan penyimpanan/jaringan secara eksplisit.
- Setiap perubahan perilaku menyertakan tes kasus normal, input invalid, serta
  kegagalan jaringan/penyimpanan. Jalankan `npm run typecheck`, tes relevan,
  dan `npm run build`.
- Hindari perubahan tak terkait. Perbarui dokumentasi dan migrasi database yang
  relevan bersama perubahan arsitektur.

## Design system

- Mobile-first dengan light mode `#FFF9F4`, surface `#FFFFFF`, primary
  `#F28C28`/hover `#E87917`, primary-soft `#FFF0DF`, text `#302B27`,
  secondary `#81766D`, dan border `#F0E6DD`. Dark mode memakai background
  `#171615`, surface `#211F1D`, elevated `#2A2724`, primary `#FFA64D`, text
  `#F7F2ED`, secondary `#B5AAA0`, dan border `#3A3530`.
- Gunakan Poppins, sudut 12–20px, bayangan tipis, dan spacing konsisten. Token
  CSS yang sama menggerakkan kedua tema dan utilitas Tailwind.
- Prioritaskan kontras, fokus keyboard, label dan kontrol semantik, target sentuh
  nyaman, reduced motion, serta tampilan kasir yang responsif.

## Standar keamanan

- Gunakan hanya Supabase URL dan public anon/publishable key di frontend.
  Dilarang mengirim service-role key, database password, atau kredensial privat
  ke source, contoh env, bundle, log, atau klien.
- Simpan konfigurasi lokal pada `.env.local` yang diabaikan Git. Validasi URL
  Supabase dan input sebelum menggunakannya.
- Terapkan RLS minimum-privilege pada tabel dan storage. Data POS/keuangan
  memerlukan akses berdasarkan role dan outlet yang diverifikasi di backend.
- Jangan mencatat password, token, atau data pelanggan/keuangan sensitif.
  Tetapkan retensi dan privasi sebelum menambahkan data pelanggan.

## Perintah frontend

Jalankan dari `frontend/`:

```powershell
npm install
npm run dev
npm run typecheck
npm run build
```
