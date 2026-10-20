@extends('layouts.app')
@section('title',$recipe->exists?'Edit resep':'Tambah resep')
@section('content')
<div class="mb-6"><p class="eyebrow">RACIKAN TOKO</p><h1 class="page-title">{{ $recipe->exists?'Edit resep':'Tambah resep' }}</h1></div>
@include('inventory.nav')
<form method="POST" action="{{ $recipe->exists?route('inventory.recipes.update',$recipe):route('inventory.recipes.store') }}" class="card grid max-w-3xl gap-5" x-data="recipeEditor" data-confirm="Simpan resep ini? Perubahan berlaku untuk checkout baru.">@csrf @if($recipe->exists) @method('PUT') @endif
<x-select name="product_id" label="Produk" x-model="product" @change="variant=''" :disabled="$recipe->exists" required>
<option value="">Pilih produk</option>@foreach($products as $product)<option value="{{ $product->id }}">{{ $product->name }}</option>@endforeach
</x-select>
@if($recipe->exists)<input type="hidden" name="product_id" value="{{ $recipe->product_id }}">@endif
<x-select name="product_variant_id" label="Varian" x-model="variant" :disabled="$recipe->exists">
<option value="">Standar / fallback varian</option>
<template x-for="option in variants" :key="option.id"><option :value="String(option.id)" x-text="option.name"></option></template>
</x-select>
@if($recipe->exists)<input type="hidden" name="product_variant_id" value="{{ $recipe->product_variant_id }}">@endif
<p class="text-xs text-stone-500">Takaran untuk satu item penjualan. Resep varian berisi seluruh bahan yang dipakai, bukan tambahan resep standar. Maksimal 30 bahan.</p>
<div class="grid gap-4">
<template x-for="(row,index) in rows" :key="row.key">
<div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl bg-stone-50 p-3 dark:bg-stone-800">
<div class="grid min-w-0 gap-3 sm:grid-cols-2"><label class="min-w-0 text-xs">Bahan<select class="field mt-2" :name="'items['+index+'][ingredient_id]'" x-model="row.ingredient_id" required><option value="">Pilih bahan</option>@foreach($ingredients as $ingredient)<option value="{{ $ingredient->id }}">{{ $ingredient->name }} ({{ $ingredient->unit->symbol }})</option>@endforeach</select></label><label class="text-xs">Jumlah per porsi<input type="number" min="0.001" max="999999.999" step="0.001" class="field mt-2" :name="'items['+index+'][quantity]'" x-model="row.quantity" required></label></div>
<button type="button" @click="rows.splice(index,1)" class="self-end rounded-xl p-3 text-red-600" aria-label="Hapus bahan resep">Hapus</button>
</div></template>
<button type="button" @click="add()" :disabled="rows.length>=30" class="btn btn-secondary justify-self-start">Tambah bahan</button>
</div>
<label class="flex items-center gap-3 text-sm"><input type="hidden" name="is_active" value="0"><input type="checkbox" name="is_active" value="1" @checked(old('is_active',$recipe->is_active)) class="size-5 accent-orange-500">Resep aktif</label>
<div class="flex flex-wrap gap-3"><x-button :href="route('inventory.recipes.index')" variant="secondary">Batal</x-button><x-button :disabled="$ingredients->isEmpty() || $products->isEmpty()">Simpan resep</x-button></div>
@if($ingredients->isEmpty())<p class="text-sm text-amber-700 dark:text-amber-300">Tambahkan bahan aktif terlebih dahulu.</p>@endif
</form>
@php
$recipeEditorData = [
    'product' => (string) old('product_id',$recipe->product_id ?? ''),
    'variant' => (string) old('product_variant_id',$recipe->product_variant_id ?? ''),
    'products' => $products->map(fn($product)=>['id'=>$product->id,'variants'=>$product->variants->map(fn($variant)=>['id'=>$variant->id,'name'=>$variant->name])]),
    'rows' => old('items',$recipe->exists?$recipe->items->map(fn($item)=>['ingredient_id'=>(string)$item->ingredient_id,'quantity'=>$item->quantity])->all():[['ingredient_id'=>'','quantity'=>'']]),
];
@endphp
<script type="application/json" id="recipe-editor-data">@json($recipeEditorData)</script>
@endsection
