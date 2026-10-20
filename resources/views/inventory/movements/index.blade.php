@extends('layouts.app')
@section('title','Riwayat stok')
@section('content')
<div class="mb-6"><p class="eyebrow">INVENTORI TOKO</p><h1 class="page-title">Riwayat pergerakan stok</h1><p class="mt-2 text-sm text-stone-500">Setiap mutasi memiliki alasan, referensi, saldo, dan penanggung jawab.</p></div>
@include('inventory.nav')
@include('inventory.filters')
<section class="card !p-0"><x-table><thead><tr><th>Waktu / pengguna</th><th>Bahan</th><th>Jenis</th><th>Perubahan</th><th>Sebelum / sesudah</th><th>Referensi / alasan</th></tr></thead><tbody>
@forelse($movements as $movement)<tr>
<td class="whitespace-nowrap">{{ $movement->created_at->format('d/m/Y H:i') }}<span class="mt-1 block text-xs text-stone-500">{{ $movement->user->name }}</span></td>
<td class="font-semibold">{{ $movement->ingredient_name }}</td>
<td><x-badge :status="$movement->type==='receipt'?'active':'info'">{{ ['receipt'=>'Masuk','adjustment'=>'Penyesuaian','consumption'=>'Pemakaian'][$movement->type] }}</x-badge></td>
<td class="whitespace-nowrap font-semibold {{ str_starts_with($movement->quantity,'-')?'text-red-600 dark:text-red-400':'text-emerald-700 dark:text-emerald-400' }}">{{ $movement->quantity }} {{ $movement->unit_symbol }}</td>
<td class="whitespace-nowrap text-xs">{{ $movement->stock_before }} / {{ $movement->stock_after }} {{ $movement->unit_symbol }}</td>
<td class="min-w-52 max-w-sm break-words">@if($movement->sale)<a class="font-semibold text-brand" href="{{ route('transactions.show',$movement->sale) }}">{{ $movement->reference }}</a>@else<span class="font-medium">{{ $movement->reference }}</span>@endif<p class="mt-1 text-xs text-stone-500">{{ $movement->reason }}</p></td>
</tr>@empty<tr><td colspan="6"><x-empty title="Belum ada mutasi" description="Stok masuk, penyesuaian, dan pemakaian resep akan muncul di sini."/></td></tr>@endforelse
</tbody></x-table><div class="p-5">{{ $movements->links() }}</div></section>
@endsection
