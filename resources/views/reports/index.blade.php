@extends('layouts.app')
@section('title','Laporan')
@section('content')
<div class="mb-7"><p class="eyebrow">ANALITIK TOKO</p><h1 class="page-title">Laporan penjualan</h1><p class="mt-2 text-sm text-stone-500">Ringkasan dari transaksi berstatus lunas.</p></div>
<form class="card mb-6 flex flex-wrap items-end gap-3"><label class="text-xs">Dari<input class="field mt-2" type="date" name="from" value="{{ $from }}"></label><label class="text-xs">Sampai<input class="field mt-2" type="date" name="to" value="{{ $to }}"></label><x-button type="submit">Terapkan</x-button></form>
<div class="grid gap-4 sm:grid-cols-2"><article class="card"><p class="text-sm text-stone-500">Total penjualan</p><p class="mt-3 text-3xl font-semibold text-brand">@money($total)</p></article><article class="card"><p class="text-sm text-stone-500">Transaksi lunas</p><p class="mt-3 text-3xl font-semibold">{{ $count }}</p></article></div><section class="card mt-6"><h2 class="font-semibold">Per metode pembayaran</h2><div class="mt-5 grid gap-4 sm:grid-cols-3">@foreach($byMethod as $method=>$amount)<div class="rounded-xl bg-stone-100 p-4 dark:bg-stone-800"><p class="text-xs uppercase text-stone-500">{{ $method }}</p><p class="mt-2 font-semibold">@money($amount)</p></div>@endforeach</div></section>
@endsection
