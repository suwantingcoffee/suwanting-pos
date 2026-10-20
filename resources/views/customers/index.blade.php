@extends('layouts.app')
@section('title','Pelanggan')
@section('content')
<div class="mb-7 flex flex-wrap items-end justify-between gap-4">
    <div><p class="eyebrow">RELASI TOKO</p><h1 class="page-title">Pelanggan</h1><p class="mt-2 text-sm text-stone-500">Kenali pelanggan. Pilih saat checkout, atau tetap gunakan pelanggan umum.</p></div>
    @can('manage-customers')<x-button :href="route('customers.create')"><i data-lucide="user-plus" class="size-4"></i>Tambah pelanggan</x-button>@endcan
</div>
<form method="GET" action="{{ route('customers.index') }}" class="mb-5 flex flex-wrap items-end gap-3">
    <label class="min-w-0 flex-1 text-sm font-medium">Cari pelanggan<input name="q" value="{{ request('q') }}" maxlength="120" class="field mt-2" placeholder="Nama atau nomor telepon"></label>
    @can('manage-customers')<label class="text-sm font-medium">Status<select name="status" class="field mt-2"><option value="">Semua status</option><option value="active" @selected(request('status')==='active')>Aktif</option><option value="inactive" @selected(request('status')==='inactive')>Nonaktif</option></select></label>@endcan
    <x-button variant="secondary">Cari</x-button>
    @if(request()->filled('q') || request()->filled('status'))<x-button :href="route('customers.index')" variant="secondary">Reset</x-button>@endif
</form>
<section class="card !p-0"><x-table>
    <thead><tr><th>Nama pelanggan</th><th>Telepon</th>@can('manage-customers')<th>Email</th>@endcan<th>Status</th>@can('manage-customers')<th>Aksi</th>@endcan</tr></thead>
    <tbody>@forelse($customers as $customer)
        <tr><td class="font-semibold">{{ $customer->name }}</td><td>{{ $customer->phone ?: '—' }}</td>@can('manage-customers')<td>{{ $customer->email ?: '—' }}</td>@endcan
            <td><x-badge :status="$customer->is_active?'active':'inactive'">{{ $customer->is_active?'Aktif':'Nonaktif' }}</x-badge></td>
            @can('manage-customers')<td><div class="flex gap-2">
                <x-button :href="route('customers.edit',$customer)" variant="secondary" class="!p-2" aria-label="Edit pelanggan {{ $customer->name }}"><i data-lucide="pencil" class="size-4"></i></x-button>
                <form method="POST" action="{{ route('customers.destroy',$customer) }}" data-confirm="Arsipkan pelanggan ini? Riwayat transaksi tetap tersimpan.">@csrf @method('DELETE')<x-button variant="danger" class="!p-2" aria-label="Arsipkan pelanggan {{ $customer->name }}"><i data-lucide="archive" class="size-4"></i></x-button></form>
            </div></td>@endcan
        </tr>
    @empty<tr><td colspan="5"><x-empty title="Pelanggan belum ditemukan" description="Coba kata kunci lain atau tambahkan pelanggan baru melalui owner/admin."/></td></tr>@endforelse</tbody>
</x-table><div class="p-5">{{ $customers->links() }}</div></section>
@endsection
