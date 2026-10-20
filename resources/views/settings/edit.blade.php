@extends('layouts.app')
@section('title','Pengaturan')
@section('content')
<div class="mb-7"><p class="eyebrow">KONFIGURASI TOKO</p><h1 class="page-title">Pengaturan</h1><p class="mt-2 text-sm text-stone-500">Atur identitas toko, pajak, struk, dan periksa koneksi POS.</p></div>
<div x-data="settingsPanel" class="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
    <form method="POST" action="{{ route('settings.update') }}" class="grid min-w-0 gap-6">
        @csrf @method('PUT')
        <section class="card grid gap-5">
            <div><h2 class="font-semibold">Profil toko</h2><p class="mt-1 text-xs text-stone-500">Identitas dan kontak ini tampil pada struk.</p></div>
            <x-input name="shop_name" label="Nama toko" :value="$settings['shop_name']" maxlength="100" required/>
            <x-input name="shop_address" label="Alamat toko" :value="$settings['shop_address']" maxlength="255"/>
            <div class="grid gap-5 sm:grid-cols-2"><x-input name="shop_phone" label="Telepon toko" type="tel" :value="$settings['shop_phone']" maxlength="30"/><x-input name="shop_email" label="Email toko" type="email" :value="$settings['shop_email']" maxlength="120"/></div>
        </section>
        <section class="card grid gap-5">
            <div class="flex items-start justify-between gap-4"><div><h2 class="font-semibold">Pajak penjualan</h2><p class="mt-1 text-xs text-stone-500">Dihitung setelah diskon. Berlaku untuk checkout berikutnya.</p></div>
                <label class="flex shrink-0 items-center gap-2 text-sm font-medium"><input type="hidden" name="tax_enabled" value="0"><input type="checkbox" name="tax_enabled" value="1" x-model="taxEnabled" class="size-5 accent-orange-500"><span x-text="taxEnabled?'Aktif':'Nonaktif'"></span><span class="sr-only">Pajak</span></label>
            </div>
            <x-input name="tax_rate" label="Tarif pajak (%)" type="number" step="0.01" min="0" max="100" :value="$settings['tax_rate']" required/>
            <p class="rounded-xl bg-orange-50 p-3 text-xs leading-5 text-orange-800 dark:bg-orange-950/30 dark:text-orange-200" x-text="taxEnabled?'Pajak aktif. Server menghitung tarif ini saat checkout.':'Pajak nonaktif. Checkout memakai pajak Rp 0; tarif tetap disimpan untuk digunakan kembali.'"></p>
        </section>
        <section class="card grid gap-5">
            <div><h2 class="font-semibold">Template struk</h2><p class="mt-1 text-xs leading-5 text-stone-500">Ubah teks dan informasi yang dicetak. Rincian transaksi dan status pembayaran selalu tampil.</p></div>
            <label class="block text-sm font-medium">Ukuran kertas<select name="receipt_paper" class="field mt-2"><option value="80" @selected(old('receipt_paper',$settings['receipt_paper'])=='80')>80 mm</option><option value="58" @selected(old('receipt_paper',$settings['receipt_paper'])=='58')>58 mm</option></select></label>
            <label class="block text-sm font-medium">Teks pembuka (header)<textarea name="receipt_header" rows="3" maxlength="500" class="field mt-2" placeholder="Contoh: Kopi hangat dari lereng Merbabu">{{ old('receipt_header',$settings['receipt_header']) }}</textarea></label>
            <label class="block text-sm font-medium">Teks penutup (footer)<textarea name="receipt_footer" rows="4" maxlength="500" class="field mt-2" placeholder="Ucapan terima kasih / informasi toko">{{ old('receipt_footer',$settings['receipt_footer']) }}</textarea></label>
            <p class="-mt-3 text-xs text-stone-500">Maksimal 500 karakter per teks. Baris baru dipertahankan. HTML ditampilkan sebagai teks.</p>
            <div class="grid gap-4 sm:grid-cols-2">
                @foreach(['receipt_show_cashier'=>'Tampilkan nama kasir','receipt_show_customer'=>'Tampilkan pelanggan','receipt_show_sku'=>'Tampilkan SKU produk','receipt_auto_print'=>'Buka dialog cetak otomatis'] as $key=>$label)
                <label class="flex items-center gap-3 text-sm"><input type="hidden" name="{{ $key }}" value="0"><input type="checkbox" name="{{ $key }}" value="1" @checked(old($key,$settings[$key])) class="size-5 accent-orange-500">{{ $label }}</label>
                @endforeach
            </div>
            <div><button type="submit" name="_method" value="POST" formaction="{{ route('settings.receipt-preview') }}" formtarget="_blank" class="btn btn-secondary"><i data-lucide="receipt-text" class="size-4"></i>Pratinjau struk</button><p class="mt-2 text-xs text-stone-500">Buka contoh pada tab baru menggunakan isian saat ini, sebelum disimpan.</p></div>
        </section>
        <div class="flex flex-wrap items-center gap-3"><x-button><i data-lucide="save" class="size-4"></i>Simpan pengaturan</x-button><p class="text-xs text-stone-500">Total transaksi lama tetap mengikuti nilai saat checkout.</p></div>
    </form>
    <aside class="grid gap-6 xl:sticky xl:top-24">
        <section class="card">
            <h2 class="font-semibold">Koneksi internet</h2><p class="mt-2 text-xs leading-5 text-stone-500">Uji akses internet dari server POS ke layanan pemeriksaan Google. Hasil menunjukkan kondisi saat diperiksa.</p>
            <div class="mt-4 rounded-xl bg-stone-50 p-3 text-xs dark:bg-stone-800"><p class="font-medium">Indikator perangkat</p><p class="mt-1 text-stone-500" x-text="deviceOnline?'Jaringan terdeteksi (perkiraan browser).':'Browser mendeteksi perangkat offline.'"></p></div>
            <button type="button" @click="checkConnection()" :disabled="checking" class="btn btn-secondary mt-4 w-full disabled:opacity-50" x-text="checking?'Memeriksa…':'Cek koneksi sekarang'"></button>
            <div x-cloak x-show="connectionMessage" class="mt-4 text-xs leading-5" role="status" aria-live="polite"><p x-text="connectionMessage"></p><p x-show="latency!==null" class="mt-1 text-stone-500"><span x-text="latency"></span> ms</p><p x-show="checkedAt" class="mt-1 text-stone-500" x-text="checkedAt"></p></div>
        </section>
        <section class="card"><h2 class="font-semibold">Tampilan & akses</h2><p class="mt-2 text-xs leading-5 text-stone-500">Tema terang/gelap tersimpan per perangkat. Hak akses pengguna dikelola oleh owner.</p><button type="button" data-theme-toggle class="btn btn-secondary mt-4 w-full"><i data-lucide="sun-moon" class="size-4"></i>Ganti tema</button><x-button :href="route('users.index')" variant="secondary" class="mt-3 w-full">Kelola pengguna</x-button><x-button :href="route('audit.index')" variant="secondary" class="mt-3 w-full">Lihat audit aktivitas</x-button></section>
    </aside>
</div>
@php
    $settingsData = ['taxEnabled'=>(bool) old('tax_enabled',$settings['tax_enabled']),'connectionUrl'=>route('settings.connection-check')];
@endphp
<script type="application/json" id="settings-data">@json($settingsData)</script>
@endsection
