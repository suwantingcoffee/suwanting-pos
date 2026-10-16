# Panduan deployment produksi

Panduan ini menyiapkan Supabase dan Vercel untuk instalasi baru Suwanting Coffee
POS. Gunakan proyek Supabase terpisah untuk development, staging, dan produksi.
Tidak ada perintah di bawah ini yang sudah dijalankan pada proyek hosted.

## 1. Buat proyek Supabase

1. Buat proyek baru pada organisasi Supabase yang benar. Pilih region dekat
   pengguna, simpan password database di password manager, dan siapkan billing
   serta kapasitas yang sesuai.
2. Jangan gunakan proyek situs Beta atau database yang sudah berisi data lain.
   Migration ini membangun skema POS baru, bukan mengimpor atau mengubah data
   Beta.
3. Ambil Project URL dan Publishable key dari halaman **Connect** atau
   **Project Settings → API Keys**. Publishable key aman untuk browser. Jangan
   mengambil `service_role`/secret key untuk frontend.
4. Konfigurasikan Authentication:
   - Nonaktifkan pendaftaran publik sebelum membuat akun produksi.
   - Aktifkan metode sign-in yang memang akan dipakai; siapkan SMTP/domain email
     produksi bila memakai email invitation atau reset password.
   - Atur site URL dan redirect URL hanya ke domain produksi serta domain lokal
     yang diperlukan. Jangan biarkan wildcard atau URL preview yang tidak
     dikelola.
   - Buat akun owner melalui undangan Admin/Authentication Dashboard, bukan
     signup publik. Verifikasi alamat email dan pastikan pengguna dapat login.
5. Batasi akses Dashboard/SQL Editor ke operator yang berwenang dan aktifkan
   MFA untuk akun admin. Catat project ref dan pemilik operasional secara aman.

## 2. Tinjau dan jalankan migration

Gunakan Node.js 20+, Supabase CLI versi yang berlaku, dan akun operator yang
berwenang. Kerjakan dahulu pada proyek staging kosong. Baca
`docs/SUPABASE.md` dan seluruh SQL migration, lalu:

```powershell
supabase login
supabase projects list
supabase link --project-ref <PROJECT_REF>
supabase migration list --linked
supabase db push --linked --dry-run
```

Pastikan project ref menunjuk proyek yang tepat, daftar remote tidak berisi
migration POS yang tak terduga, dan dry-run hanya menambahkan migration yang
ditinjau. Bila database bukan proyek POS baru yang kosong, **berhenti**:
jangan mendorong baseline ini ke database tersebut. Buat backup, pulihkan ke
staging terisolasi, rancang forward migration khusus, dan verifikasi dampaknya
terlebih dahulu. Jangan mengedit migration yang pernah diterapkan.

Setelah staging lulus validasi dan persetujuan perubahan, jalankan:

```powershell
supabase db push --linked
supabase migration list --linked
```

Ulangi proses review, backup, dry-run, persetujuan, dan apply untuk produksi
pada jendela perubahan. Migration berada di `supabase/migrations/`, berurutan
dari `20261016000100_foundation.sql` sampai `20261016001800_reporting.sql`.
Perubahan yang gagal harus ditangani melalui migration perbaikan yang ditinjau;
jangan menghapus skema atau mengubah riwayat migration untuk memaksa sukses.

## 3. Buat owner pertama dan outlet

Jangan aktifkan signup publik untuk membuat owner. Setelah Auth Dashboard
mengundang/membuat akun pertama dan pengguna telah tercatat di Auth, gunakan
SQL Editor admin satu kali untuk bootstrap organisasi dan membership owner.
Ganti placeholder dengan alamat email yang tepat dan nama organisasi. Periksa
proyek yang sedang dipilih sebelum menjalankan:

```sql
DO $$
DECLARE
  v_owner_id uuid;
  v_organization_id uuid;
BEGIN
  SELECT id INTO STRICT v_owner_id
  FROM auth.users
  WHERE lower(email) = lower('OWNER_EMAIL');

  IF EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = v_owner_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Owner user already has an active organization membership';
  END IF;

  INSERT INTO public.organizations (name, currency)
  VALUES ('Suwanting Coffee', 'IDR')
  RETURNING id INTO v_organization_id;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_organization_id, v_owner_id, 'owner');

  RAISE NOTICE 'Organization created: %', v_organization_id;
END
$$;
```

Script memilih tepat satu user Auth dengan email tersebut, menggagalkan
pengulangan untuk user yang sudah memiliki membership aktif, dan memberi role
melalui tabel membership (bukan metadata Auth). Catat UUID organisasi dari
notifikasi SQL Editor, lalu buat outlet pertama:

```sql
INSERT INTO public.outlets (organization_id, code, name)
VALUES ('ORGANIZATION_UUID', 'MAIN', 'Outlet Utama')
RETURNING id, organization_id, code, name;
```

Trigger database membuat lokasi penyimpanan utama `MAIN` untuk outlet baru.
Login sebagai owner pada `/products`; keanggotaan dan outlet akan tersedia
sesudah refresh. Pembuatan outlet dari SQL Editor hanya diperlukan karena
workflow pembuatan outlet belum tersedia pada UI. Simpan UUID organisasi dan
outlet pada password manager operasional/ticket terbatas, bukan di source code.

## 4. Setup data operasional awal

1. Di **Produk**, buat kategori dan satuan yang dipakai (kode satuan
   kanonis: `g`, `kg`, `ml`, `l`, `pcs`), lalu produk dan varian lengkap dengan
   SKU, satuan stok, harga, dan kategori.
2. Pastikan outlet/lokasi aktif yang benar dipilih. Lokasi utama `MAIN`
   terbentuk otomatis; lokasi tambahan dapat dibuat di **Inventori → Lokasi**.
3. Catat stok pembukaan dari **Inventori → Mutasi stok → Barang masuk** dengan
   jumlah fisik, biaya per satuan yang didukung dokumen, dan catatan seperti
   `Saldo awal <tanggal> / <dokumen referensi>`. Ini membentuk ledger mutasi
   aktual; jangan mengarang riwayat atau biaya historis.
4. Di **Keuangan**, siapkan akun kas/rekening/pembayaran, kategori beban, dan
   konfigurasi kasir sebelum transaksi pertama. Pastikan saldo awal rekening
   dan prosedur rekonsiliasi dicatat sesuai dokumen. Jangan memakai omzet
   historis sebagai saldo kas.
5. Uji pembukaan shift, penjualan dan pembayaran, stok, jurnal, laporan, refund,
   serta tutup dan rekonsiliasi shift pada staging dengan data sintetis sebelum
   produksi. Jangan mengimpor data pribadi atau akun demo.

## 5. Environment dan GitHub Pages

GitHub Pages meng-host **frontend statis saja**. Supabase tetap menjadi backend
terpisah untuk Auth, database, RLS, dan RPC. Repository sebaiknya berisi source
code saja, bukan `.env.local`, database password, maupun server secret.

1. Buat repository GitHub baru (misalnya `suwanting-pos`) dan unggah folder
   proyek ini, termasuk `frontend/`, `supabase/`, `tests/`, dan
   `.github/workflows/deploy-github-pages.yml`. Pertahankan kedua lockfile.
2. Pada repository GitHub buka **Settings → Pages**, pilih **GitHub Actions**
   sebagai Build and deployment source. Workflow akan berjalan ketika ada push
   ke branch `main`, atau dapat dijalankan manual dari **Actions**.
3. Jika Pages belum pernah diaktifkan untuk repository, buat fine-grained
   personal access token untuk repository ini saja, berikan izin **Pages: Read
   and write**, lalu simpan token sebagai Actions secret bernama
   `PAGES_ENABLEMENT_TOKEN`. Workflow menggunakannya hanya pada langkah
   Configure Pages untuk mengaktifkan site. Jangan tempel token ke chat, file,
   source, atau variabel `VITE_*`. Workflow kembali memakai `GITHUB_TOKEN`
   setelah Pages terdaftar; setelah itu hapus secret dan revoke token. Jika
   Pages sudah aktif, secret tersebut tidak diperlukan.
4. Jika Supabase staging sudah siap, buka **Settings → Secrets and variables →
   Actions → Variables** dan tambahkan:
   - `VITE_SUPABASE_URL` = Project URL staging.
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = publishable key untuk proyek yang sama.
5. Workflow menghitung base path secara otomatis untuk project site
   (`https://<owner>.github.io/<repo>/`) dan user site
   (`https://<owner>.github.io/`), serta memakai HashRouter supaya refresh route
   seperti `/#/reports` tetap berfungsi di hosting statis. Key publishable
   memang dikemas dalam bundle browser; jangan menambahkan service-role key
   sebagai repository variable/secret atau variabel `VITE_*`.
6. Setelah workflow sukses, URL publik tersedia di **Settings → Pages** atau
   ringkasan deployment. Tanpa dua variable Supabase tersebut, situs masih
   dapat dimuat tetapi fitur yang memerlukan database akan menampilkan error
   konfigurasi, bukan data operasional.
7. Konfigurasikan Supabase Auth Site URL/redirect URL agar sesuai domain
   `github.io` yang terbit. Pastikan database migration sudah diterapkan di
   Supabase dan akun owner/outlet sudah diprovisioning sebelum penggunaan nyata.
8. Jika memakai GitHub Free, repository publik biasanya pilihan paling mudah
   untuk Pages; periksa aturan Pages/plan GitHub saat ini sebelum memilih
   visibilitas repository. Jangan unggah data pelanggan atau data produksi ke
   repository.

## 6. Environment dan Vercel

1. Buat proyek Vercel dari repository yang telah ditinjau, set **Root
   Directory** ke `frontend/`, aktifkan pengaturan root directory untuk
   instalasi/build, dan pilih framework preset **Vite**.
2. Konfigurasi:
   - Install Command: `npm ci`
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Development Command (opsional): `npm run dev`
3. Tambahkan hanya environment frontend berikut di Vercel untuk environment
   yang diperlukan (Production, Preview, Development):
   - `VITE_SUPABASE_URL` = URL proyek yang sesuai.
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = publishable key proyek yang sama.
4. Jangan tambahkan service-role key, secret key, database password, access
   token, maupun credentials admin. Konfigurasi Vite menggagalkan build saat
   mendeteksi pola secret pada variabel `VITE_*`. Gunakan publishable key untuk
   semua build browser.
5. Konfigurasi domain produksi, HTTPS, DNS, dan redirect URLs Auth. Preview
   deployment sebaiknya menggunakan proyek Supabase staging, bukan produksi.
6. `frontend/vercel.json` mengarahkan URL aplikasi ke `index.html`, dan Vite
   memakai asset base `/`; keduanya mendukung refresh pada route seperti
   `/reports` atau `/products`. Periksa langsung URL route setelah deploy.

## 7. Backup, restore, dan perubahan versi

- Pilih paket Supabase yang menyediakan retensi dan Point-in-Time Recovery
  sesuai RPO/RTO bisnis; periksa status dan retensi backup di Dashboard.
- Sebelum migration produksi, ambil backup melalui Dashboard/fitur backup yang
  tersedia untuk paket tersebut. Simpan ekspor terenkripsi dengan akses
  terbatas di luar repository dan di luar workspace developer.
- Uji restore secara berkala ke proyek terpisah: pastikan schema, Auth yang
  diperlukan, data, RLS, akses aplikasi, dan konsistensi jurnal/stok. Backup
  yang belum pernah dipulihkan belum terverifikasi.
- Deploy migration sebagai perubahan versi yang ditinjau. Uji di staging,
  periksa `supabase migration list --linked`, lakukan dry-run sebelum apply,
  lalu lakukan smoke test pasca-deploy. Jangan memodifikasi migration yang
  sudah dipublikasikan.
- Tidak ada prosedur down migration destruktif. Bila perlu rollback, gunakan
  migration forward yang aman atau restore backup/PITR ke target yang
  diverifikasi; rencanakan dampak data sebelum mengganti endpoint produksi.

## 8. Pemantauan dan troubleshooting

- Periksa Supabase **Logs/Reports** untuk Auth, Postgres, API, dan koneksi.
  Batasi akses log dan jangan menyalin token atau data pelanggan ke ticket.
- Pantau error UI/browser dan deployment Vercel; gunakan project error
  monitoring yang disetujui dengan redaksi PII, jangan merekam kredensial atau
  payload pembayaran.
- `supabase db push` menolak objek/riwayat yang tidak sesuai: pastikan project
  ref, akses database, dan migration remote; jangan menghapus objek agar
  perintah lulus.
- Aplikasi kembali menampilkan error konfigurasi/login bila URL/key salah.
  Cocokkan URL dengan key dari proyek yang sama dan pastikan key bersifat
  publishable/anon.
- Login gagal setelah deploy: periksa akun Auth, verifikasi email, SMTP,
  site/redirect URL, dan status signup yang sengaja dinonaktifkan. Pastikan
  membership organisasi aktif dan scope outlet sesuai.
- Route internal 404 atau halaman kosong: verifikasi Root Directory `frontend`,
  output `dist`, rewrite Vercel, serta bahwa aset browser berhasil dimuat dari
  path `/assets/...`.
- Tes Auth/RLS hosted hanya pada proyek staging. Tes dan kredensial pada root
  `.env.example` ditujukan untuk Supabase lokal.

## Status verifikasi

Build lokal dapat dijalankan dari workspace dengan `npm --prefix frontend run
build`. Belum ada akses atau bukti bahwa proyek Supabase/Vercel hosted telah
dibuat, migration remote telah dijalankan, backup aktif, domain live, ataupun
alur produksi hosted telah diverifikasi. Operator tetap harus menjalankan
langkah dashboard di atas dan merekam hasil sesuai prosedur perubahan.
