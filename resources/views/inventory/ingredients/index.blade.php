@extends('layouts.app')
@section('title','Bahan baku')
@section('content')
<div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p class="eyebrow">INVENTORI TOKO</p><h1 class="page-title">Bahan baku</h1><p class="mt-2 text-sm text-stone-500">Stok terhubung resep dan penjualan lunas.</p></div><x-button :href="route('inventory.ingredients.create')">Tambah bahan</x-button></div>
@include('inventory.nav')
@if($lowCount)
<a href="{{ route('inventory.ingredients.index',['low'=>1]) }}" class="mb-5 block rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><b>{{ $lowCount }} bahan mencapai stok minimum.</b> Periksa dan jadwalkan stok masuk.</a>
@endif
<form class="card mb-5 flex flex-wrap items-end gap-3">
<div class="min-w-0 flex-1"><x-input name="q" label="Cari bahan / SKU" :value="request('q')" placeholder="Biji kopi, susu..." /></div>
<label class="flex items-center gap-2 py-3 text-sm"><input type="checkbox" name="low" value="1" @checked(request('low'))>Hanya stok minimum</label>
<x-button>Filter</x-button><x-button :href="route('inventory.ingredients.index')" variant="secondary">Reset</x-button></form>
<section class="card !p-0"><x-table><thead><tr><th>Bahan / SKU</th><th>Stok</th><th>Minimum</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
@forelse($ingredients as $ingredient)
<tr><td><b>{{ $ingredient->name }}</b><span class="mt-1 block font-mono text-xs text-stone-500">{{ $ingredient->sku }}</span></td>
<td class="whitespace-nowrap font-semibold">{{ $ingredient->stock_quantity }} {{ $ingredient->unit->symbol }}</td><td class="whitespace-nowrap">{{ $ingredient->minimum_stock }} {{ $ingredient->unit->symbol }}</td>
<td><x-badge :status="!$ingredient->is_active?'inactive':($ingredient->stock_quantity <= $ingredient->minimum_stock?'pending':'active')">{{ !$ingredient->is_active?'Nonaktif':($ingredient->stock_quantity <= $ingredient->minimum_stock?'Stok rendah':'Cukup') }}</x-badge></td>
<td><div class="flex flex-wrap gap-2"><x-button :href="route('inventory.movements.create',$ingredient)" variant="secondary">Mutasi</x-button><x-button :href="route('inventory.ingredients.edit',$ingredient)" variant="secondary">Edit</x-button>
<form method="POST" action="{{ route('inventory.ingredients.destroy',$ingredient) }}" data-confirm="Arsipkan bahan ini? Riwayat tetap tersimpan.">@csrf @method('DELETE')<x-button variant="danger" aria-label="Arsipkan bahan">Arsip</x-button></form></div></td></tr>
@empty<tr><td colspan="5"><x-empty title="Bahan belum tersedia" description="Tambahkan satuan dasar, lalu bahan baku dan stok masuk."/></td></tr>@endforelse
</tbody></x-table><div class="p-5">{{ $ingredients->links() }}</div></section>
@endsection
