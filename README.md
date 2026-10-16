# Suwanting Coffee POS

Aplikasi kasir dan operasional berbasis React, TypeScript, Vite, dan Supabase.
Frontend produksi berada di `frontend/`; migration database berurutan berada di
`supabase/migrations/`.

## Setup lokal

Memerlukan Node.js 20+ dan npm. Dari root proyek:

```powershell
npm ci
npm --prefix frontend ci
npm run dev
```

Dev server membuka aplikasi di `http://127.0.0.1:5173`. Tanpa konfigurasi
Supabase, UI akan memberi pesan bahwa backend belum dikonfigurasi; untuk
menggunakan data nyata, isi `frontend/.env.local` dengan URL dan publishable key
Supabase development. Untuk backend lokal, pasang Supabase CLI dan Docker
Desktop, lalu jalankan:

```powershell
supabase start
supabase migration up --local
supabase status
npm --prefix frontend run dev
```

Jangan membagikan output lengkap `supabase status`; output dapat memuat
kredensial lokal. Detail Auth dan migrasi ada di
[docs/SUPABASE.md](docs/SUPABASE.md).

## Environment dan keamanan

Salin [frontend/.env.example](frontend/.env.example) sebagai
`frontend/.env.local`, lalu atur:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Publishable key (atau legacy anon key) memang dapat dilihat di browser; akses
data harus dibatasi oleh RLS dan fungsi database. Jangan pernah menaruh
service-role/secret key, password database, atau token admin di variabel `VITE_*`,
file `.env.example`, maupun repository. Vite akan menghentikan build bila
variabel rahasia yang namanya diawali `VITE_` terdeteksi. `.env*` lokal
diabaikan Git kecuali `.env.example`.

`frontend/.env.example` adalah konfigurasi aplikasi. Root `.env.example` hanya
untuk tes HTTP Supabase lokal; jangan isi dengan kredensial produksi.

## Build dan pemeriksaan

```powershell
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm test
npm run test:concurrency
npm run test:ui
```

Build menjalankan lint dan typecheck sebelum membuat `frontend/dist`. Pengujian
Supabase lokal opsional memerlukan Supabase CLI/Docker dan key publik lokal:
`npm run test:supabase`. Jangan arahkan tes yang memutasi data ke proyek
produksi.

## Deployment

Panduan pembuatan proyek Supabase, migrasi aman, provisioning owner, konfigurasi
Vercel, GitHub Pages, backup/restore, pemantauan, dan troubleshooting ada di
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). GitHub Actions siap membangun
`frontend/dist` dan menerbitkan GitHub Pages setelah repository dan Pages
diaktifkan. Vercel dapat memakai `frontend/` sebagai Root Directory; Build
Command `npm run build`; Output Directory `dist`.

### Unggah ke GitHub dan aktifkan GitHub Pages

1. Buat repository kosong di GitHub, lalu dari PowerShell pada root proyek:

   ```powershell
   git init
   git add .
   git commit -m "Initial Suwanting Coffee POS"
   git branch -M main
   git remote add origin https://github.com/<USERNAME>/<REPOSITORY>.git
   git push -u origin main
   ```

   Ganti URL dengan repository Anda. Folder ini belum terhubung ke remote
   GitHub. Sebelum mengunggah, pastikan tidak ada credential atau data produksi
   dalam source; `.env.local` diabaikan Git.
2. Pada repository GitHub pilih **Settings → Pages → Build and deployment →
   GitHub Actions**. Workflow deploy berjalan pada push ke `main`.
3. Untuk mengaktifkan Pages otomatis pada deployment pertama, buat fine-grained
   personal access token terbatas ke repository ini dengan izin **Pages: Read
   and write**, lalu simpan di **Settings → Secrets and variables → Actions**
   dengan nama `PAGES_ENABLEMENT_TOKEN`. Jangan bagikan token. Setelah Pages
   berhasil aktif, hapus secret dan revoke token tersebut.
4. Untuk menggunakan backend Supabase, tambahkan `VITE_SUPABASE_URL` dan
   `VITE_SUPABASE_PUBLISHABLE_KEY` sebagai repository **Actions Variables**.
   Jangan gunakan service-role key. Ikuti
   [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) untuk setup Supabase.
5. Tunggu workflow **Deploy frontend to GitHub Pages** sukses di tab **Actions**.
   URL situs akan tercantum di **Settings → Pages**. URL project umumnya
   `https://<USERNAME>.github.io/<REPOSITORY>/`; route aplikasi menggunakan
   hash, misalnya `/#/reports`, agar kompatibel dengan hosting statis.

Deployment hosted belum dijalankan dari repository ini. Pembuatan proyek
Supabase, pengaturan Auth/SMTP/backup, environment Vercel, domain, migration
remote, dan verifikasi URL live tetap membutuhkan akses dashboard dan tindakan
operator.

## Status aplikasi

POS, produk, inventori, pembelian, produksi, keuangan, dashboard, dan laporan
menggunakan Supabase serta otorisasi database. Fitur dan batas operasional
dijelaskan pada [docs/POS.md](docs/POS.md),
[docs/PRODUCTS_INVENTORY.md](docs/PRODUCTS_INVENTORY.md),
[docs/FINANCE.md](docs/FINANCE.md), dan [docs/REPORTING.md](docs/REPORTING.md).
Dashboard dan laporan menerapkan definisi metrik tersendiri; omzet bukan laba.

Hasil pengujian terakhir dan batas integrasi tercatat di
[docs/TEST_RESULTS.md](docs/TEST_RESULTS.md). Jangan menganggap tes lokal sebagai
bukti bahwa Auth, RLS, backup, atau deployment proyek Supabase hosted telah
diverifikasi.
