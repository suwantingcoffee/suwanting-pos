@extends('layouts.app')
@section('title',$ingredient->exists?'Edit bahan':'Tambah bahan')
@section('content')
<div class="mb-6"><p class="eyebrow">INVENTORI TOKO</p><h1 class="page-title">{{ $ingredient->exists?'Edit bahan baku':'Tambah bahan baku' }}</h1></div>
@include('inventory.nav')
@if($units->isEmpty())<div class="card mb-5 text-sm">Belum ada satuan dasar. <a class="font-semibold text-brand" href="{{ route('inventory.units.create') }}">Tambah satuan</a> terlebih dahulu.</div>@endif
<form method="POST" action="{{ $ingredient->exists?route('inventory.ingredients.update',$ingredient):route('inventory.ingredients.store') }}" class="card grid max-w-2xl gap-5">@csrf @if($ingredient->exists) @method('PUT') @endif
<x-input name="name" label="Nama bahan" :value="$ingredient->name" maxlength="120" required/>
<x-input name="sku" label="SKU bahan" :value="$ingredient->sku" maxlength="40" required/>
<x-select name="inventory_unit_id" label="Satuan dasar" required>
<option value="">Pilih satuan</option>@foreach($units as $unit)<option value="{{ $unit->id }}" @selected(old('inventory_unit_id',$ingredient->inventory_unit_id)==$unit->id)>{{ $unit->name }} ({{ $unit->symbol }})</option>@endforeach
</x-select>
<p class="text-xs text-stone-500">Semua stok dan resep memakai satuan ini. Satuan bahan yang sudah dibuat tidak dapat diganti.</p>
<x-input name="minimum_stock" label="Stok minimum" type="number" step="0.001" min="0" max="999999999.999" :value="$ingredient->minimum_stock" required/>
<label class="flex items-center gap-3 text-sm"><input type="hidden" name="is_active" value="0"><input type="checkbox" name="is_active" value="1" @checked(old('is_active',$ingredient->is_active)) class="size-5 accent-orange-500">Bahan aktif</label>
<p class="rounded-xl bg-stone-100 p-3 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">Stok awal nol. Catat penerimaan melalui tombol Mutasi; saldo tidak dapat diedit langsung.</p>
<div class="flex gap-3"><x-button :href="route('inventory.ingredients.index')" variant="secondary">Batal</x-button><x-button :disabled="$units->isEmpty()">Simpan bahan</x-button></div>
</form>
@endsection
