@extends('layouts.app')
@section('title',$sale->invoice_number)
@section('content')
<div class="mb-7 flex flex-wrap items-end justify-between gap-4"><div class="min-w-0"><p class="eyebrow">DETAIL TRANSAKSI</p><h1 class="break-all text-xl font-semibold">{{ $sale->invoice_number }}</h1><p class="mt-2 text-sm text-stone-500">{{ $sale->created_at->format('d M Y, H:i') }} · {{ $sale->cashier->name }}{{ $sale->is_demo?' · Data demo':'' }}</p></div><div class="flex gap-3"><x-button :href="route('transactions.index')" variant="secondary">Kembali</x-button><x-button :href="route('transactions.print',$sale)" variant="secondary" target="_blank" rel="noopener"><i data-lucide="printer" class="size-4"></i>Cetak struk</x-button></div></div>
<div class="grid gap-6 lg:grid-cols-[1fr_340px]"><section class="card"><div class="flex justify-between gap-3"><h2 class="font-semibold">Item pesanan</h2><span class="text-sm text-stone-500">{{ $sale->customer_name?:'Pelanggan umum' }}</span></div>
<div class="mt-5 divide-y divide-stone-100 dark:divide-stone-800">@foreach($sale->items as $item)<div class="flex justify-between gap-4 py-4"><div><p class="font-medium">{{ $item->product_name }}</p><p class="mt-1 text-xs text-stone-500">{{ $item->variant_name?:'Standar' }} · {{ $item->sku }}</p><p class="mt-1 text-xs text-stone-500">{{ $item->quantity }} × @money($item->unit_price)</p>@if($item->notes)<p class="mt-2 rounded-lg bg-stone-100 p-2 text-xs dark:bg-stone-800">{{ $item->notes }}</p>@endif</div><strong class="whitespace-nowrap text-sm">@money($item->subtotal)</strong></div>@endforeach</div>
@if($sale->notes)<p class="mt-4 text-sm text-stone-500">Catatan: {{ $sale->notes }}</p>@endif
</section>
<aside class="card"><div class="flex justify-between text-sm"><span class="text-stone-500">Subtotal</span><b>@money($sale->subtotal)</b></div><div class="mt-3 flex justify-between text-sm"><span class="text-stone-500">Diskon</span><b>- @money($sale->discount)</b></div><div class="mt-3 flex justify-between text-sm"><span class="text-stone-500">Pajak {{ $sale->tax_rate }}%</span><b>@money($sale->tax_amount)</b></div><div class="mt-4 flex justify-between border-t border-dashed border-stone-300 pt-4 text-xl font-semibold dark:border-stone-700"><span>Total</span><span class="text-brand">@money($sale->total)</span></div>
<div class="mt-6 rounded-xl bg-stone-100 p-4 text-sm dark:bg-stone-800"><p class="font-semibold uppercase">{{ $sale->payment?->method }}</p><p class="mt-2 text-xs text-stone-500">Diterima: @money($sale->payment?->amount_received)</p><p class="mt-1 text-xs text-stone-500">Kembalian: @money($sale->payment?->change_amount)</p>
@if($sale->payment?->is_simulated)<p class="mt-3 text-xs font-medium text-orange-600">Pembayaran simulasi · tanpa gateway</p>@endif
<x-badge :status="$sale->status" class="mt-3">{{ $sale->status==='paid'?'Lunas':'Menunggu' }}</x-badge>
</div>
@if($sale->status==='pending' && $sale->payment?->is_simulated && config('pos.simulate_payments'))
<form method="POST" action="{{ route('transactions.confirm',$sale) }}" data-confirm="Simulasikan pembayaran ini sebagai diterima? Status penjualan akan berubah menjadi lunas.">@csrf<input type="hidden" name="confirmed" value="1"><x-button class="mt-5 w-full">Simulasikan pembayaran diterima</x-button></form>
@endif
@if($sale->items->contains(fn($item)=>$item->ingredients->isNotEmpty()))
<p class="mt-5 rounded-xl bg-orange-50 p-3 text-xs leading-5 text-orange-900 dark:bg-orange-950/30 dark:text-orange-200">{{ $sale->inventory_deducted_at?'Pemakaian bahan resep sudah dicatat.':'Stok bahan belum dipotong atau direservasi. Ketersediaan diperiksa saat pembayaran dikonfirmasi lunas.' }}</p>
@can('manage-inventory')
<a href="{{ route('inventory.movements.index',['q'=>$sale->invoice_number,'type'=>'consumption']) }}" class="mt-3 block text-xs font-semibold text-brand">Riwayat pemakaian bahan</a>
@endcan
@endif
</aside></div>
@endsection
