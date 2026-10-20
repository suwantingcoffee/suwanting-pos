@extends('layouts.app')
@section('title','Mutasi stok')
@section('content')
<div class="mb-6"><p class="eyebrow">INVENTORI TOKO</p><h1 class="page-title">Mutasi stok</h1><p class="mt-2 text-sm text-stone-500">{{ $ingredient->name }} · Saldo {{ $ingredient->stock_quantity }} {{ $ingredient->unit->symbol }}</p></div>
@include('inventory.nav')
<form method="POST" action="{{ route('inventory.movements.store',$ingredient) }}" class="card grid max-w-2xl gap-5" x-data="{ type: @js(old('type','receipt')) }" data-confirm="Catat mutasi stok ini? Perubahan masuk riwayat permanen.">@csrf
<input type="hidden" name="idempotency_key" value="{{ old('idempotency_key',$idempotencyKey) }}">
<x-select name="type" label="Jenis mutasi" x-model="type"><option value="receipt">Stok masuk</option><option value="adjustment">Penyesuaian stok</option></x-select>
<div x-show="type==='adjustment'" x-cloak><x-select name="direction" label="Arah penyesuaian"><option value="add" @selected(old('direction')==='add')>Tambah stok</option><option value="remove" @selected(old('direction')==='remove')>Kurangi stok</option></x-select></div>
<x-input name="quantity" :label="'Jumlah ('.$ingredient->unit->symbol.')'" type="number" min="0.001" max="999999999.999" step="0.001" required/>
<x-input name="reference" label="Referensi dokumen / penerimaan" maxlength="120" placeholder="SJ-001 / opname-2026-10" x-bind:required="type==='receipt'"/>
<label class="block text-sm font-medium">Alasan mutasi<textarea class="field mt-2" name="reason" minlength="3" maxlength="500" rows="3" placeholder="Penerimaan bahan, hasil stok opname, tumpah, kedaluwarsa..." required>{{ old('reason') }}</textarea></label>
<p class="text-xs text-stone-500">Isi selisih stok, bukan saldo akhir. Semua jumlah memakai satuan dasar. Koreksi mutasi melalui penyesuaian baru dengan alasan; riwayat tidak dapat dihapus.</p>
<div class="flex flex-wrap gap-3"><x-button :href="route('inventory.ingredients.index')" variant="secondary">Batal</x-button><x-button :disabled="!$ingredient->is_active">Catat mutasi</x-button></div>
</form>
@endsection
