@extends('layouts.app')
@section('title','Resep produk')
@section('content')
<div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p class="eyebrow">RACIKAN TOKO</p><h1 class="page-title">Resep produk & varian</h1><p class="mt-2 max-w-2xl text-sm text-stone-500">Resep varian menggantikan seluruh resep produk. Jika resep varian tidak aktif, resep produk dipakai sebagai fallback.</p></div><x-button :href="route('inventory.recipes.create')">Tambah resep</x-button></div>
@include('inventory.nav')
<form class="card mb-5 flex items-end gap-3"><div class="min-w-0 flex-1"><x-input name="q" label="Cari produk" :value="request('q')"/></div><x-button>Cari</x-button></form>
<div class="grid gap-4 md:grid-cols-2">
@forelse($recipes as $recipe)
<article class="card"><div class="flex items-start justify-between gap-3"><div><h2 class="font-semibold">{{ $recipe->product->name }}</h2><p class="mt-1 text-xs text-stone-500">{{ $recipe->variant?->name ?? 'Standar / fallback varian' }}</p></div><x-badge :status="$recipe->is_active?'active':'inactive'">{{ $recipe->is_active?'Aktif':'Nonaktif' }}</x-badge></div>
<ul class="my-5 grid gap-3">@foreach($recipe->items as $item)<li class="flex justify-between gap-3 text-sm"><span>{{ $item->ingredient->name }} @if(!$item->ingredient->is_active || $item->ingredient->trashed())<span class="text-red-600">(nonaktif)</span>@endif</span><b class="whitespace-nowrap">{{ $item->quantity }} {{ $item->ingredient->unit->symbol }}</b></li>@endforeach</ul>
<div class="flex flex-wrap gap-2"><x-button :href="route('inventory.recipes.edit',$recipe)" variant="secondary">Edit resep</x-button>@if($recipe->is_active)<form method="POST" action="{{ route('inventory.recipes.destroy',$recipe) }}" data-confirm="Nonaktifkan resep? Resep varian akan kembali memakai resep produk jika tersedia. Produk tanpa resep aktif tidak memotong stok.">@csrf @method('DELETE')<x-button variant="danger">Nonaktifkan</x-button></form>@endif</div>
</article>
@empty<div class="card md:col-span-2"><x-empty title="Belum ada resep" description="Hubungkan bahan dan takaran per porsi. Produk tanpa resep tetap dapat dijual tanpa mutasi bahan."/></div>@endforelse
</div><div class="mt-5">{{ $recipes->links() }}</div>
@endsection
