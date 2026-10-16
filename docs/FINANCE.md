# Modul keuangan

Halaman `/finance` menggunakan Supabase untuk dashboard, pencatatan transaksi,
rekonsiliasi, jurnal, dan riwayat audit. Data dibatasi oleh organisasi dan outlet
aktif; rentang laporan memakai tanggal akhir eksklusif. Nilai disimpan sebagai
`numeric` di database dan ditampilkan dalam IDR.

## Ringkasan yang ditampilkan

- Omzet order selesai, penerimaan pembayaran, refund, dan pembayaran yang masih
  menunggu settlement ditampilkan sebagai nilai terpisah.
- Kas masuk/keluar dihitung dari `cash_movements`; saldo kas dihitung per akun.
- Pemasukan lain, beban operasional, pembelian aset, modal, penerimaan pinjaman,
  pembayaran pokok, bunga, dan biaya pinjaman memiliki metrik tersendiri.
- Dashboard tidak menyebut selisih omzet dan penerimaan sebagai laba. Laporan
  laba rugi formal belum disediakan.

## Pencatatan dan jurnal

Gunakan tombol transaksi untuk mencatat pemasukan, beban berkategori, modal
pemilik, pembelian aset, pinjaman, dan cicilan. Cicilan memisahkan pokok, bunga,
serta biaya pinjaman; setiap komponen dicatat ke akun yang berbeda. Pembelian
aset mendebit aset tetap, bukan beban operasional. Pencatatan dilakukan melalui
RPC dengan idempotency key; jangan mengirim ulang transaksi dengan payload baru
selama permintaan sebelumnya belum dipastikan.

Transaksi uang otomatis membuat jurnal double-entry di dalam transaksi database
yang sama. constraint deferred memverifikasi debit sama dengan kredit saat
transaksi commit. Jurnal manual menerima satu baris debit dan satu baris kredit
dengan jumlah sama; server tetap memvalidasi referensi akun dan keseimbangan.
Jurnal final tidak dapat diubah atau dihapus. Koreksi dilakukan dengan reversal
atau adjustment yang menyimpan alasan dan aktor.

Refund order tetap dilakukan dari modul Transaksi/POS, memakai alur pembayaran
dan refund POS yang sudah ada; jangan membuat pengeluaran refund manual untuk
menggantikan operasi tersebut.

## Kasir dan audit

Tab Shift kasir menampilkan shift aktif/tertutup dan menyediakan rekonsiliasi
untuk shift tertutup. Server menghitung kas yang diharapkan dari saldo awal dan
mutasi dalam interval shift. Selisih disimpan satu kali dan menghasilkan
cash movement adjustment beserta jurnal.

Tab Jurnal & audit menampilkan jurnal final, jumlah debit/kredit, status
reversal, dan riwayat aktivitas dalam rentang tanggal. Sumber finansial
bersifat append-only. Akun pembayaran dan kategori pengeluaran dapat dibuat
dari tab Akun & kategori; akun bagan keuangan hanya ditampilkan sebagai baca
saja karena kode sistem menentukan pemetaan jurnal otomatis.

## Role dan otorisasi

Owner, admin, manager, dan `finance_staff` dapat membaca dashboard serta
riwayat sesuai scope outlet. Manager dapat mencatat pengeluaran/pemasukan dan
melakukan rekonsiliasi, sedangkan modal, pembelian aset, pinjaman, cicilan, dan
jurnal manual dibatasi kepada owner, admin, atau `finance_staff`. Reversal
jurnal memerlukan role owner, admin, atau manager; server tetap memeriksa role
dan akses outlet pada setiap RPC. Perubahan skema akun tidak menyediakan alur
four-eyes approval terpisah.

Migration database baru atau staging harus dijalankan berurutan melalui
`supabase/migrations`, termasuk `20261016001700_finance_operations.sql`.
Jangan terapkan migration langsung pada database produksi berisi data tanpa
backup dan staging.
