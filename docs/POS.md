# Modul POS kasir

Modul `/cashier` dan `/transactions` memakai Supabase secara langsung. Tombol
checkout tidak mengubah state tampilan saja: setiap order dibuat melalui
`hold_order`, pembayaran melalui `finalize_pos_order`, dan stok dipotong hanya
di database ketika order menjadi `completed`.

## Pelanggan dan privasi

Halaman `/customers` memakai tabel `customers` dan kebijakan RLS POS yang
sudah ada; tidak memerlukan migration baru. Owner, admin, manager, dan kasir
dapat menambah, mengubah, mengarsipkan, serta memulihkan pelanggan. Finance
staff dapat membaca tanpa mengubah kontak; inventory staff tidak mendapat
akses. Database tetap menjadi pengendali izin, bukan visibilitas tombol.

Daftar mendukung pagination dan pencarian nama, serta memisahkan data aktif
dari arsip. Form hanya menyimpan nama dan kontak yang diberikan; pencarian tidak
mengindeks nomor telepon/email dan tidak ada ekspor massal data kontak.
Arsip hanya mengatur `archived_at`: riwayat transaksi/struk tidak dihapus,
sementara alur kasir menolak pelanggan yang telah diarsipkan. Simpan hanya data
kontak yang diperlukan dan sesuai izin pelanggan.

## Alur transaksi

Kasir memilih varian dari `pos_catalog`. RPC mengabaikan harga/total dari
browser, mengambil harga, SKU, nama, resep, promosi aktif, pajak outlet, dan
stok dari database, lalu membuat order `held` dengan snapshot immutable. Hold
tidak mengurangi stok. Resume memakai `revision` untuk mencegah dua kasir
mengambil order yang sama.

`finalize_pos_order` menerima paling banyak sepuluh bagian pembayaran. Tunai
langsung menjadi `paid`, mencatat tendered amount, kembalian, cash movement, dan
jurnal uang muka. Transfer, QRIS, dan kartu dibuat sebagai `pending`; aplikasi
tidak menganggap provider berhasil. Karena provider belum ditentukan, owner,
admin, manager, atau finance staff harus memeriksa settlement sebenarnya dan
mengisi reference serta catatan melalui tombol **Verifikasi settlement**. Setelah
semua dana terkonfirmasi, tombol pembayaran tanpa bagian memanggil finalisasi
stok/jurnal. Jika stok habis setelah settlement elektronik, pembayaran tetap
disimpan sebagai fakta dan dapat direfund; transaksi tidak dibuat seolah-olah
terjual.

Status order (`held`, `pending`, `completed`, `voided`) terpisah dari status
pembayaran (`pending`, `paid`, `failed`, `partial`, `refunded`,
`partially_refunded`). Refund memilih payment asal, dibatasi oleh sisa nominal,
memerlukan alasan, dan untuk metode elektronik memerlukan reference refund.
Refund tidak mengembalikan stok otomatis. Void hanya untuk order terbuka tanpa
dana yang belum dikembalikan atau attempt yang masih pending, memerlukan role
manager ke atas, dan diaudit.

## Retry dan konkurensi

Key hold, finalisasi, dan refund disimpan di `sessionStorage` sebelum request.
Payload menjadi immutable sampai respons database diketahui. Error PostgreSQL
yang definitif membuka form kembali; timeout/network error tetap mengunci
payload agar kasir mengulangi request yang sama atau memeriksa histori. RPC
memakai unique idempotency key, advisory lock per outlet, row lock order, dan
`inventory_operations`; dua checkout yang berebut stok terakhir hanya dapat
memiliki satu pemenang. Payment allocation dan refund juga tidak dapat melebihi
nominal melalui race.

## Struk dan histori

Detail transaksi menampilkan snapshot nama/SKU/harga/catatan, subtotal, diskon,
pajak, total, payment status, kembalian, attempt, dan refund. Tombol Print
menggunakan portal print-only dengan timezone `Asia/Jakarta`; order yang belum
`completed` diberi penanda bahwa struk belum merupakan penjualan selesai.
Histori mendukung pencarian receipt/UUID, status order/payment, open-only,
pagination server-side, dan tanggal dari/sampai dalam WIB (batas sampai dibuat
eksklusif pada hari berikutnya).

## Batas akuntansi

Pembayaran dan pendapatan/pajak diposting berimbang melalui akun `2100-POS`,
`4000`, `2200-POS`, dan akun kas. Biaya historis bahan disimpan pada konsumsi
order dan digunakan untuk margin di laporan berikutnya. Jurnal COGS otomatis
terpisah dari implementasi ini; jangan menganggap margin final hanya dari total
penjualan.

## Pengujian

`npm test` menguji total server, promo, pajak, kembalian, split payment,
settlement paid/failed, stok kurang dan rollback, double submission, refund
bertahap dengan pembulatan pajak, perubahan resep setelah hold, zero-total, RLS
lintas organisasi, dan payload API. `npm run test:concurrency` memakai beberapa
koneksi PostgreSQL native untuk race stok/order/payment/refund. `npm run test:ui`
menguji katalog, hold/resume, mobile cart, split QRIS manual, receipt print,
retry payload, serta konfirmasi refund/void dengan API tiruan.

Provider gateway belum dikonfigurasi. Mengisi publishable key Supabase saja
tidak memverifikasi QRIS/kartu; integrasi webhook provider perlu ditambahkan
sebelum settlement otomatis diaktifkan.
