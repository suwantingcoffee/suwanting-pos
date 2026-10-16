# Produk, inventori, dan produksi

Modul `/products` dan `/inventory` menggunakan Supabase Auth serta data nyata
organisasi/outlet yang dapat dibaca akun tersebut. Dashboard utama tetap DEMO.
Login memerlukan akun Auth dengan membership aktif. Konfigurasi public client
dan instalasi database dijelaskan di [SUPABASE.md](SUPABASE.md).

## Pemasangan

Pada database POS yang sudah menjalankan migration 001–006, tinjau dan pasang
hanya migration forward 007–013 secara berurutan. Jangan mengulang baseline atau
mereset database berisi data. Buat backup, restore ke staging, jalankan migrasi,
dan periksa rekonsiliasi sebelum deployment produksi. Pekerjaan ini tidak
menjalankan migration pada database remote.

| Migration | Perubahan |
| --- | --- |
| 007 inventory_model | Metadata unit, foto/status/varian, lokasi/saldo lokasi, operasi idempoten, biaya dan snapshot |
| 008 inventory_operations | Konversi, satu pencatat stok, transfer, opname, minimum, query saldo |
| 009 purchasing_production | PO bersatuan, penerimaan penuh, versi resep, produksi aktual |
| 010 sale_consumption | Konsumsi checkout satu kali dan snapshot biaya/bahan |
| 011 catalog | Simpan produk/varian atomik, arsip, guard stok, constraint angka finite |
| 012 catalog_search | Pencarian nama/SKU/barcode, filter dan pagination server |
| 013 inventory_indexes | Melengkapi indeks FK baru |

007 membuat lokasi `MAIN` bagi outlet yang sudah ada dan menyalin saldo agregat
ke lokasi itu tanpa mengubah jumlah stok. Unit g/kg/ml/l/pc/pcs dinormalisasi
secara konsisten. Ledger historis tidak dibuat ulang. Biaya historis yang tidak
tersedia tetap NULL; nilai buku stok lama dimulai dari 0, bukan rekonstruksi
biaya sebenarnya. Tinjau nilai pembukaan pada staging dengan bagian finance;
margin atas stok warisan belum dapat dianggap akurat sampai dasar biayanya
direkonsiliasi. Tes forward migration memakai database berisi data dan installer
non-superuser.

## Produk dan master

- Tab Kategori dan Satuan: tambah/edit/arsip/pulihkan. Gunakan kode `g`, `kg`,
  `ml`, `l`, atau `pcs`. Seed development opt-in menyediakan unit-unit ini.
- Katalog: cari nama, SKU, barcode atau varian; filter kategori/status. Daftar
  dipaginasi di server, 20 baris per halaman.
- Produk: nama, kategori, deskripsi, URL foto HTTPS dengan pratinjau, status aktif.
  Foto menggunakan URL gambar yang sudah tersedia; unggah file/bucket Storage
  belum disediakan.
- Varian: ukuran/nama, SKU, barcode, satuan stok, harga per penjualan, biaya awal
  per satuan stok, jumlah stok per penjualan, status, dan mode konsumsi.
  SKU/barcode unik per organisasi. Penyimpanan produk beserta varian atomik:
  kesalahan satu varian membatalkan seluruh penyimpanan.
- Penghapusan berarti arsip setelah konfirmasi. Varian yang dikeluarkan dari
  formulir diarsipkan saat produk disimpan. Histori tetap tersedia.
- Produk/varian dengan stok positif harus dikosongkan sebelum dinonaktifkan,
  diarsipkan atau dipindah mode stok. Satuan stok tidak boleh diganti setelah
  movement pertama. Kode/faktor konversi unit tidak dapat diubah; buat unit baru.

Contoh kopi kemasan 100 g: satuan stok `g`, harga jual `35000`, jumlah per
penjualan `100`. Biaya awal `100` berarti Rp100 per gram. Menjual dua kemasan
mengurangi 200 g. Harga jual bukan harga per gram.

## Saldo dan mutasi

Saldo tersedia per outlet dan lokasi. Lokasi utama dibuat otomatis saat outlet
dibuat; lokasi tambahan dapat dibuat/diarsipkan pada tab Lokasi. Lokasi berisi
stok tidak bisa diarsipkan. Minimum stock berlaku pada total outlet per varian.
Banner memeriksa jumlah varian yang mencapai minimum setiap 30 detik; tombol
Periksa memperbaruinya langsung. Filter menipis juga tersedia pada daftar saldo.

Semua perubahan kuantitas masuk `inventory_movements` dari database:

| Operasi UI | Dampak |
| --- | --- |
| Barang masuk | Menambah kuantitas dan biaya input yang dikonversi |
| Barang keluar | Mengurangi stok dan nilai menurut biaya rata-rata lokasi |
| Transfer | Dua movement sumber/tujuan, kuantitas dan biaya dipindah atomik |
| Penyesuaian | Delta bertanda + atau −, wajib alasan |
| Stok opname | Hitungan absolut, dapat nol; server menghitung selisih |
| Waste | Movement negatif dan waste_record, wajib alasan |

Transfer antar outlet hanya berhasil jika akun berizin pada **kedua** outlet
dalam organisasi yang sama. Inventory staff yang dibatasi satu outlet tidak
bisa mengirim stok ke outlet lain. Semua operasi menolak stok negatif.

Opname menyertakan revisi saldo lokasi yang ditampilkan. Jika stok bergerak
setelah saldo dimuat, server menolak dengan `40001`; muat ulang lalu hitung
kembali. Hitungan sama dengan saldo tetap menyimpan operasi/audit, tanpa membuat
movement nol yang menyesatkan. Semua kuantitas stok maksimal empat desimal;
konversi yang kehilangan presisi ditolak, bukan dibulatkan diam-diam.

Riwayat mutasi dapat difilter varian, lokasi, jenis dan catatan. Nilai historis,
saldo sesudah movement, aktor dan referensi tersimpan. Ekspor CSV mengambil
seluruh halaman sesuai filter, dengan escaping kutip dan formula spreadsheet.
Ekspor beberapa halaman bukan snapshot transaksi tunggal: hindari mutasi aktif
jika membutuhkan rekonsiliasi pada satu waktu yang tepat.

## Unit dan biaya

| Dimensi | Unit dasar | Konversi |
| --- | --- | --- |
| Massa | gram | 1 kg = 1000 g |
| Volume | ml | 1 l = 1000 ml |
| Hitungan | pcs | 1 pc = 1 pcs |

Tidak ada konversi massa ke volume/hitungan. Setiap varian memiliki satuan stok
kanonis; input PO, bahan resep dan hasil produksi dapat memakai unit lain dengan
dimensi yang sama. Faktor milik organisasi diverifikasi database.

Saldo lokasi menyimpan jumlah dan nilai buku. Incoming menambah nilai berdasarkan
biaya input; outgoing memakai rata-rata tertimbang pada lokasi tersebut. Transfer
membawa biaya sumber ke tujuan. Menghabiskan saldo menghabiskan seluruh nilai
tersisa agar tidak meninggalkan sisa pembulatan. Nilai agregat outlet mengikuti
jumlah nilai lokasi. `minimum_stock` tidak mengubah kuantitas.

Biaya pada movement, receipt item, production input/output, order item dan
consumption bersifat historis. Mengubah biaya awal di katalog hanya memengaruhi
tambahan stok yang menggunakan biaya katalog; tidak mengubah dokumen selesai.
Belum ada posting jurnal COGS otomatis atau laporan margin UI.

## Supplier, PO dan penerimaan

Supplier memiliki nama, telepon, email dan alamat, dengan arsip. PO terdiri atas
supplier, nomor unik, varian, jumlah, satuan pembelian dan biaya per satuan input.
Inventory staff dapat membuat draft; owner/admin/manager menyetujui atau
membatalkan PO terbuka. Penerimaan penuh hanya untuk PO approved dan memerlukan
konfirmasi jumlah/kondisi serta lokasi.

Contoh membeli 1 kg green beans seharga Rp120000 ketika satuan stok g:
penerimaan menambah 1000 g, nilai Rp120000, biaya satuan ledger Rp120/g.
Jumlah/unit/biaya input PO dan kuantitas hasil konversi tetap tersimpan. Retry
penerimaan PO yang sama mengembalikan receipt yang sama, tanpa tambahan stok.
Penerimaan parsial, perubahan item setelah PO dibuat dan retur pembelian belum
disediakan; batalkan PO terbuka lalu buat PO yang benar jika perlu koreksi.

## Resep, roasting dan penjualan

Simpan varian dahulu, lalu buat resep dengan varian hasil, jenis menu/roasting,
yield standar, satuan yield dan daftar bahan beserta satuannya. Bahan harus berupa
varian stok, berbeda dari hasil dan unik dalam resep. Edit resep menyimpan versi
baru secara atomik; transaksi lama memakai snapshot, bukan resep terkini.

Dua mode konsumsi harus dipilih sesuai proses operasional:

1. **Potong stok produk jadi**: produksi/roasting mengurangi bahan dan menambah
   hasil. Penjualan hanya memotong hasil jadi menurut jumlah per penjualan.
2. **Potong bahan resep saat dijual**: pilih resep yang menghasilkan varian itu.
   Checkout memotong bahan sesuai proporsi yield; tidak memotong stok menu lagi.
   Varian ini tidak dapat diproduksi sebagai stok batch.

Mode Tanpa stok tersedia untuk layanan; biaya katalog disnapshot pada item.
Checkout memakai lokasi utama outlet. Transfer bahan/produk jadi dari gudang
lain ke lokasi utama sebelum penjualan. Lokasi sumber kasir belum dapat dipilih.

Batch roasting/produksi merekam jumlah setiap bahan yang benar-benar dipakai
dan yield aktual secara terpisah. Contoh 1000 g green beans menjadi 850 g roasted:
movement input −1000 g, output +850 g, seluruh biaya bahan dibebankan ke hasil.
Susut roasting tercermin pada yield aktual; waste tambahan dicatat terpisah
hanya untuk stok yang memang dibuang, agar kehilangan tidak dihitung dua kali.

Produksi menu batch tersedia bagi varian mode stok; menu mode resep dikonsumsi
oleh RPC finalisasi POS. UI kasir dan transaksi terhubung; alur hold, pembayaran,
dan snapshot konsumsi dijelaskan di [POS.md](POS.md). Pembatalan uang/refund tidak
otomatis mengembalikan bahan atau produk ke stok.

## Hak akses dan kontrak teknis

RLS seluruh 48 tabel membatasi tenant/outlet dan role dari membership database.
Organisasi/role kiriman browser hanya pemilih tampilan, tidak memberi hak.
Kasir membaca katalog; finance membaca inventori; owner/admin/manager/staf stok
dapat mengelola sesuai scope. Master katalog/resep dibagikan antar outlet dalam
organisasi; lokasi dan dokumen operasional mengikuti outlet.

`pos_writer` NOLOGIN/NOBYPASSRLS menjalankan RPC terkontrol. Frontend tidak
mempunyai INSERT/UPDATE saldo maupun movement. Fungsi private tidak dapat
dijalankan sesi API. Resep hanya dapat disimpan melalui `save_recipe`; audit,
jurnal, consumption dan ledger/dokumen final append-only.

| RPC | Kegunaan |
| --- | --- |
| `save_product`, `archive_product`, `search_product_ids` | Katalog atomik dan pencarian server |
| `mutate_stock` | Incoming/outgoing/transfer/adjustment/stocktake/waste |
| `set_minimum_stock`, `list_stock` | Batas minimum dan query saldo berhalaman |
| `create_purchase_order`, `approve_purchase_order`, `cancel_purchase_order` | Lifecycle PO |
| `receive_purchase_order_at` | Penerimaan penuh pada lokasi eksplisit |
| `save_recipe`, `run_production` | Versi resep dan produksi aktual |
| `checkout` | Harga DB, konsumsi tunggal, snapshot item/biaya, pembayaran atomik |

`mutate_stock` dan `run_production` membutuhkan UUID request key. Key sama,
payload/aktor/outlet sama mengembalikan hasil lama. Key dengan payload berbeda
ditolak. Saldo agregat dikunci sebelum saldo lokasi; transfer mengunci outlet
dalam urutan UUID untuk menghindari inversi antar transfer. Stok opname memakai
revisi tambahan.

UI mempertahankan request key selama formulir terbuka, menonaktifkan simpan saat
loading dan menampilkan error/sukses. Setelah kegagalan jaringan yang hasilnya
belum diketahui, retry dari formulir yang sama memakai payload/key sama; perubahan
payload ditolak sampai hasil diperiksa. Setelah error SQL yang memastikan transaksi
ditolak, input bisa diperbaiki dan dikirim kembali. Menutup formulir atau refresh
halaman menghilangkan state retry UI: periksa riwayat sebelum membuat mutasi baru.
RPC legacy `adjust_inventory`, `record_waste`, `produce_batch` tetap tersedia;
ketiganya tidak menyediakan kontrak retry idempoten dan tidak dipakai formulir baru.

## Pengujian

```powershell
npm test
npm run test:concurrency
npm run test:ui
npm run types
npm --prefix frontend run build
```

Tes concurrency membuat PostgreSQL native sementara dalam `.test-postgres/`,
memakai port acak localhost, menguji beberapa koneksi dengan role authenticated,
lalu shutdown normal dan menghapus hanya direktori milik run tersebut. Tidak
terhubung ke database yang sudah ada. Tes browser memakai Chrome lokal dan
respons API tiruan, tanpa membuat transaksi hosted. Jika Chrome berada di lokasi
khusus, isi `POS_CHROME_PATH`.

Lihat [TEST_RESULTS.md](TEST_RESULTS.md) untuk hasil aktual. Pengujian Auth JWT,
PostgREST dan pooling stack Supabase penuh tetap terpisah melalui
`npm run test:supabase`; hasil skip tidak dianggap lulus.
