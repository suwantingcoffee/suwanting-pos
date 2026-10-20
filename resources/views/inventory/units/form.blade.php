@extends('layouts.app')
@section('title',$unit->exists?'Edit satuan':'Tambah satuan')
@section('content')
<div class="mb-6"><p class="eyebrow">INVENTORI TOKO</p><h1 class="page-title">{{ $unit->exists?'Edit satuan dasar':'Tambah satuan dasar' }}</h1></div>
@include('inventory.nav')
<form method="POST" action="{{ $unit->exists?route('inventory.units.update',$unit):route('inventory.units.store') }}" class="card grid max-w-xl gap-5">@csrf @if($unit->exists) @method('PUT') @endif
<x-input name="name" label="Nama satuan" :value="$unit->name" placeholder="Gram" maxlength="80" required/>
<x-input name="symbol" label="Simbol satuan" :value="$unit->symbol" placeholder="g" maxlength="20" required/>
<p class="text-xs text-stone-500">Simbol yang sudah dipakai bahan tidak dapat diganti. Konversi kg ke g dilakukan sebelum mencatat stok masuk (1 kg = 1000 g).</p>
<div class="flex gap-3"><x-button :href="route('inventory.units.index')" variant="secondary">Batal</x-button><x-button>Simpan satuan</x-button></div>
</form>
@endsection
