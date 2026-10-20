@extends('layouts.app')
@section('title','Satuan dasar')
@section('content')
<div class="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p class="eyebrow">INVENTORI TOKO</p><h1 class="page-title">Satuan dasar</h1><p class="mt-2 text-sm text-stone-500">Gram, mililiter, atau buah. Masukkan jumlah langsung dalam satuan dasar.</p></div><x-button :href="route('inventory.units.create')">Tambah satuan</x-button></div>
@include('inventory.nav')
<section class="card !p-0"><x-table><thead><tr><th>Nama</th><th>Simbol</th><th>Bahan</th><th>Aksi</th></tr></thead><tbody>
@forelse($units as $unit)<tr><td class="font-semibold">{{ $unit->name }}</td><td>{{ $unit->symbol }}</td><td>{{ $unit->ingredients_count }}</td><td><div class="flex gap-2"><x-button :href="route('inventory.units.edit',$unit)" variant="secondary">Edit</x-button><form method="POST" action="{{ route('inventory.units.destroy',$unit) }}" data-confirm="Hapus satuan yang belum dipakai ini?">@csrf @method('DELETE')<x-button variant="danger">Hapus</x-button></form></div></td></tr>
@empty<tr><td colspan="4"><x-empty title="Belum ada satuan" description="Mulai dengan gram (g), mililiter (ml), dan buah (pcs)."/></td></tr>@endforelse
</tbody></x-table><div class="p-5">{{ $units->links() }}</div></section>
@endsection
