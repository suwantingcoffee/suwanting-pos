@extends('layouts.app')
@section('title','Transaksi')
@section('content')
<div class="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p class="eyebrow">AKTIVITAS PENJUALAN</p><h1 class="page-title">Riwayat transaksi</h1><p class="mt-2 text-sm text-stone-500">Invoice dan pembayaran yang boleh kamu lihat.</p></div><x-button :href="route('pos.index')"><i data-lucide="plus" class="size-4"></i>Transaksi baru</x-button></div>
<section class="card !p-0">
<form class="grid gap-3 border-b border-stone-100 p-5 sm:grid-cols-2 xl:grid-cols-4 dark:border-stone-800">
<x-input name="q" label="Cari invoice / pelanggan" :value="request('q')" maxlength="80" placeholder="SW-…"/>
<x-input name="from" label="Dari tanggal" type="date" :value="request('from')"/>
<x-input name="to" label="Sampai tanggal" type="date" :value="request('to')"/>
<x-select name="method" label="Metode"><option value="">Semua metode</option>@foreach(['cash'=>'Tunai','qris'=>'QRIS','transfer'=>'Transfer'] as $key=>$label)<option value="{{ $key }}" @selected(request('method')===$key)>{{ $label }}</option>@endforeach</x-select>
<x-select name="status" label="Status"><option value="">Semua status</option><option value="paid" @selected(request('status')==='paid')>Lunas</option><option value="pending" @selected(request('status')==='pending')>Menunggu pembayaran</option></x-select>
@if($cashiers->isNotEmpty())<x-select name="cashier" label="Kasir"><option value="">Semua kasir</option>@foreach($cashiers as $cashier)<option value="{{ $cashier->id }}" @selected(request('cashier')==$cashier->id)>{{ $cashier->name }}</option>@endforeach</x-select>@endif
<div class="flex items-end gap-2"><x-button type="submit">Terapkan</x-button><x-button variant="secondary" :href="route('transactions.index')">Reset</x-button></div>
</form>
@include('transactions.table',['sales'=>$sales])
<div class="p-5">{{ $sales->links() }}</div>
</section>
@endsection
