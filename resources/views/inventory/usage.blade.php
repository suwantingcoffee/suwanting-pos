@extends('layouts.app')
@section('title','Pemakaian bahan')
@section('content')
<div class="mb-6"><p class="eyebrow">LAPORAN INVENTORI</p><h1 class="page-title">Pemakaian bahan</h1><p class="mt-2 text-sm text-stone-500">Bahan terpakai dari penjualan lunas, berdasarkan tanggal mutasi. Stok masuk dan penyesuaian tidak dihitung.</p></div>
@include('inventory.nav')
@include('inventory.filters')
<section class="card !p-0"><x-table><thead><tr><th>Bahan (snapshot)</th><th>Total pemakaian</th><th>Transaksi</th><th>Rincian</th></tr></thead><tbody>
@forelse($usage as $row)<tr><td class="font-semibold">{{ $row->ingredient_name }}</td><td>{{ $row->used_quantity }} {{ $row->unit_symbol }}</td><td>{{ $row->sale_count }}</td><td><x-button :href="route('inventory.movements.index',array_filter(['ingredient_id'=>$row->ingredient_id,'type'=>'consumption','from'=>request('from'),'to'=>request('to')]))" variant="secondary">Lihat mutasi</x-button></td></tr>
@empty<tr><td colspan="4"><x-empty title="Belum ada pemakaian" description="Pemakaian tercatat setelah pembayaran lunas untuk produk dengan resep aktif."/></td></tr>@endforelse
</tbody></x-table><div class="p-5">{{ $usage->links() }}</div></section>
@endsection
