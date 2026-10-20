@extends('layouts.app')
@section('title',$customer->exists?'Edit pelanggan':'Tambah pelanggan')
@section('content')
<div class="mb-7"><p class="eyebrow">RELASI TOKO</p><h1 class="page-title">{{ $customer->exists?'Edit pelanggan':'Tambah pelanggan' }}</h1><p class="mt-2 text-sm text-stone-500">Cukup isi nama. Kontak dan catatan bersifat opsional.</p></div>
<form method="POST" action="{{ $customer->exists?route('customers.update',$customer):route('customers.store') }}" class="card grid max-w-2xl gap-5">
    @csrf @if($customer->exists) @method('PUT') @endif
    <x-input name="name" label="Nama pelanggan" :value="$customer->name" maxlength="120" required autocomplete="name"/>
    <div class="grid gap-5 sm:grid-cols-2"><x-input name="phone" label="Nomor telepon (opsional)" type="tel" :value="$customer->phone" maxlength="30" autocomplete="tel"/><x-input name="email" label="Email (opsional)" type="email" :value="$customer->email" maxlength="120" autocomplete="email"/></div>
    <x-input name="address" label="Alamat (opsional)" :value="$customer->address" maxlength="255" autocomplete="street-address"/>
    <label class="block text-sm font-medium">Catatan internal (opsional)<textarea name="notes" rows="3" maxlength="1000" class="field mt-2">{{ old('notes',$customer->notes) }}</textarea><span class="mt-1 block text-xs font-normal text-stone-500">Hanya tersedia bagi owner/admin.</span></label>
    <label class="flex items-center gap-3 text-sm"><input type="hidden" name="is_active" value="0"><input type="checkbox" name="is_active" value="1" @checked(old('is_active',$customer->is_active)) class="size-5 accent-orange-500">Pelanggan aktif dan dapat dipilih saat checkout</label>
    <div class="flex gap-3"><x-button :href="route('customers.index')" variant="secondary">Batal</x-button><x-button>Simpan pelanggan</x-button></div>
</form>
@endsection
