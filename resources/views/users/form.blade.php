@extends('layouts.app')
@section('title',$user->exists?'Edit pengguna':'Tambah pengguna')
@section('content')
<div class="mb-7"><p class="eyebrow">AKSES TOKO</p><h1 class="page-title">{{ $user->exists?'Edit pengguna':'Tambah pengguna' }}</h1></div>
<form method="POST" action="{{ $user->exists?route('users.update',$user):route('users.store') }}" data-confirm="Simpan perubahan akun dan hak akses ini?" class="card grid max-w-2xl gap-5 sm:grid-cols-2">
@csrf @if($user->exists) @method('PUT') @endif
<x-input name="name" label="Nama" :value="$user->name" required/>
<x-input name="email" label="Email" type="email" :value="$user->email" required/>
<x-select name="role" label="Role" required>
@foreach(['owner'=>'Owner','admin'=>'Admin','cashier'=>'Kasir'] as $role=>$label)<option value="{{ $role }}" @selected(old('role',$user->role??'cashier')===$role)>{{ $label }}</option>@endforeach
</x-select>
<x-input name="password" :label="$user->exists?'Password baru (opsional)':'Password'" type="password" :required="!$user->exists" minlength="8" autocomplete="new-password"/>
<label class="flex items-center gap-3 text-sm"><input type="hidden" name="is_active" value="0"><input type="checkbox" name="is_active" value="1" @checked(old('is_active',$user->exists?$user->is_active:true)) class="size-5 accent-orange-500">Akun aktif</label>
<label class="flex items-center gap-3 text-sm"><input type="hidden" name="can_manage_catalog" value="0"><input type="checkbox" name="can_manage_catalog" value="1" @checked(old('can_manage_catalog',$user->can_manage_catalog)) class="size-5 accent-orange-500">Admin boleh mengelola katalog</label>
<label class="flex items-center gap-3 text-sm"><input type="hidden" name="can_discount" value="0"><input type="checkbox" name="can_discount" value="1" @checked(old('can_discount',$user->can_discount)) class="size-5 accent-orange-500">Admin boleh memberi diskon</label>
<p class="text-xs leading-5 text-stone-500 sm:col-span-2">Owner memiliki akses penuh. Hak tambahan hanya berlaku untuk admin. Kasir mengakses penjualan miliknya sendiri.</p>
<div class="flex gap-3 sm:col-span-2"><x-button :href="route('users.index')" variant="secondary">Batal</x-button><x-button>Simpan pengguna</x-button></div>
</form>
@endsection
