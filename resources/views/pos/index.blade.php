@extends('layouts.app')
@section('title','Kasir')
@section('content')
<div x-data="pos">
<div class="mb-6 flex flex-wrap items-center justify-between gap-3"><div><p class="eyebrow">POINT OF SALE</p><h1 class="page-title">Racik pesanan hari ini.</h1><p class="mt-2 text-sm text-stone-500">Pilih menu. Sesuaikan racikan. Layani dengan hati.</p></div><x-badge status="active">Siap melayani</x-badge></div>
<div class="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
<section class="min-w-0"><div class="relative"><i data-lucide="search" class="absolute top-3.5 left-4 size-5 text-stone-400"></i><input x-model="search" class="field !py-3 !pl-12" aria-label="Cari produk" placeholder="Cari nama menu atau SKU…"></div>
<div class="my-5 flex gap-2 overflow-x-auto pb-1"><button type="button" @click="category='all'" :class="category==='all'?'bg-brand text-white':'bg-white dark:bg-stone-900'" class="chip">Semua menu</button>@foreach($categories as $category)<button type="button" @click="category='{{ $category->id }}'" :class="category==='{{ $category->id }}'?'bg-brand text-white':'bg-white dark:bg-stone-900'" class="chip">{{ $category->name }}</button>@endforeach</div>
<div class="grid min-w-0 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
@foreach($products as $product)
<article class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900" x-show="matches({{ $product->id }})">
<div class="product-art {{ $product->product_type==='beans'?'art-beans':($product->product_type==='food'?'art-food':'') }}">
@if($product->photo_path)<img src="{{ route('products.photo',$product) }}" alt="{{ $product->name }}" class="absolute inset-0 h-full w-full object-cover" loading="lazy">@else<i data-lucide="{{ $product->product_type==='beans'?'package':($product->product_type==='food'?'croissant':'coffee') }}" class="size-16 text-orange-950/50 dark:text-orange-100/60" aria-hidden="true"></i>@endif
<span class="absolute top-3 left-3 rounded-full bg-white/85 px-2 py-1 text-[10px] font-medium text-stone-700">{{ $product->category->name }}</span></div>
<div class="p-4"><p class="mb-1 text-[10px] tracking-wide text-stone-400">{{ $product->sku }}</p><h2 class="min-h-10 text-sm font-semibold">{{ $product->name }}</h2>
@if($product->variants->isNotEmpty())<select x-model="selectedVariants[{{ $product->id }}]" class="field mt-2 !py-1.5 !text-xs" aria-label="Varian {{ $product->name }}"><option value="">Standar</option>@foreach($product->variants as $variant)<option value="{{ $variant->id }}">{{ $variant->name }} (+{{ \App\Services\Money::format($variant->price_adjustment) }})</option>@endforeach</select>@endif
<div class="mt-4 flex items-center justify-between gap-2"><strong class="text-sm text-brand">@money($product->selling_price)</strong><button type="button" @click="add({{ $product->id }})" class="flex size-9 items-center justify-center rounded-xl bg-brand text-white hover:bg-orange-600" aria-label="Tambah {{ $product->name }}"><i data-lucide="plus" class="size-4"></i></button></div></div></article>
@endforeach
</div>
@if($products->isEmpty())<x-empty title="Menu belum tersedia" description="Minta owner atau admin menambahkan produk dan mengaktifkan kategori."/>@endif
<div x-cloak x-show="products.length && !products.some(p=>matches(p.id))"><x-empty title="Menu tidak ditemukan" description="Coba kata kunci atau kategori lain."/></div>
</section>
<div x-show="cartOpen" x-cloak @click="cartOpen=false" class="fixed inset-0 z-40 bg-black/40 xl:hidden"></div>
<aside class="cart-panel fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-3xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-900 xl:sticky xl:top-24 xl:z-10 xl:block xl:max-h-[calc(100dvh-7rem)] xl:rounded-2xl xl:shadow-sm" :class="cartOpen?'block':'hidden xl:block'">
<div class="flex items-center justify-between border-b border-stone-100 p-5 dark:border-stone-800"><div><h2 class="font-semibold">Pesanan pelanggan</h2><p class="mt-1 text-xs text-stone-500"><span x-text="count"></span> item dipilih</p></div><button type="button" @click="cartOpen=false" class="btn btn-secondary !p-2 xl:hidden" aria-label="Tutup keranjang">✕</button><button type="button" @click="clearCart()" class="hidden text-xs text-stone-500 xl:block">Kosongkan</button></div>
<div class="p-5">
<div class="rounded-xl border border-stone-200 p-3 dark:border-stone-700">
    <p class="text-xs font-medium">Pelanggan <span class="font-normal text-stone-500">(opsional)</span></p>
    <template x-if="selectedCustomer"><div class="mt-2 flex items-start justify-between gap-2"><div class="min-w-0"><p class="break-words text-sm font-semibold" x-text="selectedCustomer.name"></p><p class="mt-1 text-xs text-stone-500" x-text="selectedCustomer.phone || 'Pelanggan terdaftar'"></p></div><button type="button" @click="clearCustomer()" class="text-xs font-semibold text-brand">Ganti</button></div></template>
    <div x-show="!selectedCustomer">
        <button type="button" @click="customerPicker=!customerPicker; if(customerPicker) findCustomers()" :aria-expanded="customerPicker" class="mt-2 text-xs font-semibold text-brand" x-text="customerPicker?'Tutup pencarian':'Pilih pelanggan terdaftar'"></button>
        <div x-cloak x-show="customerPicker" class="mt-3">
            <label class="block text-xs text-stone-500">Cari nama atau telepon<input x-model="customerQuery" @input.debounce.300ms="findCustomers()" maxlength="120" class="field mt-2 !text-xs" placeholder="Nama / telepon" autocomplete="off"></label>
            <div class="mt-2 max-h-44 overflow-y-auto" aria-live="polite" :aria-busy="customersBusy">
                <p x-show="customersBusy" class="p-2 text-xs text-stone-500">Mencari pelanggan…</p>
                <p x-show="customerError" x-text="customerError" class="p-2 text-xs text-red-600" role="alert"></p>
                <template x-for="person in customerResults" :key="person.id"><button type="button" @click="chooseCustomer(person)" class="block w-full rounded-lg p-2 text-left hover:bg-orange-50 dark:hover:bg-orange-950/30"><span class="block break-words text-xs font-semibold" x-text="person.name"></span><span class="mt-1 block text-[10px] text-stone-500" x-text="person.phone || 'Tanpa telepon'"></span></button></template>
                <p x-show="!customersBusy && !customerError && !customerResults.length" class="p-2 text-xs text-stone-500">Belum ada pelanggan yang cocok. Tetap bisa checkout sebagai pelanggan umum.</p>
            </div>
            <p class="mt-2 text-[10px] text-stone-400">Maksimal 20 hasil. Ketik lebih lengkap untuk mempersempit pencarian.</p>
        </div>
        <label class="mt-3 block text-xs text-stone-500">Nama / meja pelanggan umum<input x-model="customer" maxlength="120" class="field mt-2 !text-xs" placeholder="Boleh kosong · Meja 03 / takeaway"></label>
    </div>
</div>
<div class="my-5 grid gap-4"><template x-if="!lines.length"><div class="py-7 text-center"><i data-lucide="shopping-basket" class="mx-auto mb-3 size-10 text-stone-300"></i><p class="text-sm font-semibold">Belum ada yang diracik.</p><p class="mt-2 text-xs text-stone-500">Tambah menu untuk memulai pesanan.</p></div></template>
<template x-for="(line,index) in lines" :key="line.key"><div class="border-b border-stone-100 pb-4 dark:border-stone-800"><div class="flex items-start justify-between gap-3"><div><p class="text-sm font-medium" x-text="line.name"></p><p class="mt-1 text-[10px] text-stone-500" x-text="line.variantName||'Standar'"></p><p class="mt-1 text-xs text-brand" x-text="money(line.price*line.quantity)"></p></div><div class="flex items-center gap-2"><button type="button" @click="change(index,-1)" class="qty-button" aria-label="Kurangi kuantitas">−</button><span class="w-5 text-center text-sm" x-text="line.quantity"></span><button type="button" @click="change(index,1)" class="qty-button" aria-label="Tambah kuantitas">+</button></div></div><input x-model="line.notes" maxlength="255" class="field mt-2 !py-1.5 !text-xs" placeholder="Catatan: less ice, tanpa gula…" aria-label="Catatan item"></div></template></div>
<div class="grid gap-3 text-sm"><div class="flex justify-between"><span class="text-stone-500">Subtotal</span><span x-text="money(subtotal)"></span></div>
@can('discount')<label class="flex items-center justify-between gap-3 text-stone-500">Diskon (Rp)<input x-model="discount" type="number" min="0" step="0.01" class="field !w-32 text-right" aria-label="Diskon rupiah"></label>@endcan
<div class="flex justify-between text-stone-500"><span>{{ $taxEnabled?'Pajak '.$taxRate.'%':'Pajak nonaktif' }}</span><span x-text="money(tax)"></span></div><div class="flex justify-between border-t border-dashed border-stone-300 pt-4 text-lg font-semibold dark:border-stone-700"><span>Total</span><span class="text-brand" x-text="money(total)"></span></div></div>
<label class="mt-5 block text-xs font-medium">Metode pembayaran<select x-model="method" @change="confirmed=false" class="field mt-2"><option value="cash">Tunai</option><option value="qris">QRIS · simulasi</option><option value="transfer">Transfer · simulasi</option></select></label>
<div x-show="method==='cash'" class="mt-4"><label class="text-xs font-medium">Nominal diterima (Rp)<input x-model="received" type="number" min="0" step="0.01" class="field mt-2" placeholder="0"></label><button type="button" @click="received=(total/100).toFixed(2)" class="mt-2 text-xs font-semibold text-brand">Gunakan uang pas</button><p class="mt-3 flex justify-between text-sm"><span class="text-stone-500">Kembalian</span><b x-text="money(Math.max(0,cents(received)-total))"></b></p></div>
<label x-cloak x-show="method!=='cash'" class="mt-4 flex items-start gap-2 rounded-xl bg-orange-50 p-3 text-xs leading-5 text-orange-800 dark:bg-orange-950/30 dark:text-orange-200"><input type="checkbox" x-model="confirmed" class="mt-1">Simulasikan pembayaran diterima. Jika tidak dicentang, pesanan berstatus menunggu.</label>
<p x-cloak x-show="error" x-text="error" role="alert" class="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-800"></p>
<button type="button" @click="review()" :disabled="!lines.length||busy" class="btn btn-primary mt-5 w-full disabled:opacity-40"><span x-text="busy?'Menyimpan…':'Periksa pembayaran'"></span><i data-lucide="arrow-right" class="size-4"></i></button><button type="button" @click="clearCart()" class="mt-4 w-full text-xs text-stone-400 xl:hidden">Kosongkan keranjang</button>
<p class="mt-4 text-center text-[10px] text-stone-400">Total akhir divalidasi kembali oleh server.</p>
</div></aside></div>
<button type="button" @click="cartOpen=true" class="btn btn-primary fixed right-4 bottom-24 left-4 z-30 shadow-lg xl:hidden">Lihat keranjang · <span x-text="count"></span> item <span x-text="money(total)"></span></button>
<x-modal id="checkout-dialog" title="Konfirmasi pesanan"><p class="text-sm text-stone-500">Pastikan pesanan dan pembayaran sudah sesuai. Total akhir mengikuti harga dan pajak di server.</p><div class="my-5 rounded-xl bg-orange-50 p-4 text-center dark:bg-orange-950/30"><p class="text-xs text-stone-500">Estimasi total</p><b class="mt-2 block text-2xl text-brand" x-text="money(total)"></b></div><p class="text-xs text-stone-500" x-text="method==='cash'?'Pembayaran tunai dicatat lunas.':(confirmed?'Simulasi pembayaran akan dicatat lunas.':'Pembayaran dicatat menunggu konfirmasi simulasi.')"></p><div class="mt-6 flex justify-end gap-3"><button @click="closeReview()" type="button" class="btn btn-secondary" :disabled="busy">Periksa lagi</button><button @click="checkout()" type="button" class="btn btn-primary" :disabled="busy" x-text="busy?'Menyimpan…':'Simpan pesanan'"></button></div></x-modal>
@php
    $posData = ['products'=>$products,'taxRate'=>$taxRate,'checkoutUrl'=>route('pos.checkout'),'customerLookupUrl'=>route('customers.lookup')];
@endphp
<script type="application/json" id="pos-data">@json($posData)</script>
</div>
@endsection
