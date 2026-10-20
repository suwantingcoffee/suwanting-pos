@extends('layouts.app')
@section('title',$category->exists?'Edit kategori':'Tambah kategori')
@section('content')
<div class="mb-7"><p class="eyebrow">KATALOG TOKO</p><h1 class="page-title">{{ $category->exists?'Edit kategori':'Tambah kategori' }}</h1></div>
<form method="POST" action="{{ $category->exists?route('categories.update',$category):route('categories.store') }}" class="card max-w-xl">@csrf @if($category->exists) @method('PUT') @endif<x-input name="name" label="Nama kategori" :value="$category->name" required/><label class="mt-5 flex items-center gap-3 text-sm"><input type="hidden" name="is_active" value="0"><input type="checkbox" name="is_active" value="1" @checked(old('is_active',$category->exists?$category->is_active:true)) class="size-5 accent-orange-500">Kategori aktif</label><div class="mt-6 flex gap-3"><x-button :href="route('categories.index')" variant="secondary">Batal</x-button><x-button>Simpan</x-button></div></form>
@endsection
