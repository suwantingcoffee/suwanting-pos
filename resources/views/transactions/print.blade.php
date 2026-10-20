@php
    $preview = $preview ?? false;
    $paper = (string) ($settings['receipt_paper'] ?? '80') === '58' ? '58' : '80';
    $contentWidth = $paper === '58' ? '50' : '72';
@endphp
<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{ $sale->invoice_number }}</title>
<style>
    *{box-sizing:border-box}body{font:12px ui-monospace,monospace;width:{{ $contentWidth }}mm;max-width:100%;margin:24px auto;padding:8px;color:#222;line-height:1.6;overflow-wrap:anywhere}
    h1{text-align:center;font:700 18px system-ui}.row{display:flex;justify-content:space-between;gap:12px;margin:6px 0}.row b,.row strong{flex-shrink:0}.line{border-top:1px dashed #888;margin:14px 0;padding-top:10px}.muted{font-size:10px;color:#555}.center{text-align:center}.template-text{white-space:pre-wrap}.preview{border:1px solid #F28500;padding:8px;font:12px system-ui}.preview b{display:block;color:#a95300}button{width:100%;padding:10px;cursor:pointer}
    @media print{@page{margin:4mm}body{padding:0;margin:0;width:{{ $contentWidth }}mm}button,.preview{display:none}}
</style></head>
<body>
@if($preview)<div class="preview"><b>Pratinjau struk · {{ $paper }} mm</b>Contoh tampilan. Pengaturan belum disimpan.</div>@endif
<h1>{{ $settings['shop_name'] ?? 'Suwanting Coffee' }}</h1>
@if($settings['shop_address'] ?? '')<p class="center muted">{{ $settings['shop_address'] }}</p>@endif
@if($settings['shop_phone'] ?? '')<p class="center muted">Telp: {{ $settings['shop_phone'] }}</p>@endif
@if($settings['shop_email'] ?? '')<p class="center muted">{{ $settings['shop_email'] }}</p>@endif
@if($settings['receipt_header'] ?? '')<p class="center template-text">{{ $settings['receipt_header'] }}</p>@endif
<p class="center">{{ $sale->invoice_number }}<br>{{ $sale->created_at->format('d/m/Y H:i') }}
@if($settings['receipt_show_cashier'] ?? true)<br>Kasir: {{ $sale->cashier->name }}@endif
@if($settings['receipt_show_customer'] ?? true)<br>{{ $sale->customer_name ?: 'Pelanggan umum' }}@endif</p>
@if($sale->is_demo)<p class="center"><strong>STRUK DEMO / SIMULASI</strong></p>@endif
<div class="line">@foreach($sale->items as $item)
    <p><strong>{{ $item->product_name }}</strong>@if($item->variant_name)<br><span class="muted">{{ $item->variant_name }}</span>@endif
    @if($settings['receipt_show_sku'] ?? false)<br><span class="muted">{{ $item->sku }}</span>@endif</p>
    <div class="row"><span>{{ $item->quantity }} × @money($item->unit_price)</span><b>@money($item->subtotal)</b></div>
    @if($item->notes)<p class="muted">{{ $item->notes }}</p>@endif
@endforeach</div>
<div class="row"><span>Subtotal</span><b>@money($sale->subtotal)</b></div>
<div class="row"><span>Diskon</span><b>- @money($sale->discount)</b></div>
<div class="row"><span>Pajak {{ $sale->tax_rate }}%</span><b>@money($sale->tax_amount)</b></div>
<div class="line"><div class="row"><strong>Total</strong><strong>@money($sale->total)</strong></div></div>
<div class="row"><span>Metode</span><b>{{ strtoupper($sale->payment?->method ?? '') }}</b></div>
<div class="row"><span>Diterima</span><b>@money($sale->payment?->amount_received)</b></div>
<div class="row"><span>Kembalian</span><b>@money($sale->payment?->change_amount)</b></div>
<p class="center"><strong>{{ $sale->status==='paid'?'LUNAS':'MENUNGGU PEMBAYARAN' }}</strong></p>
@if($sale->payment?->is_simulated)<p class="center muted">Pembayaran simulasi. Tanpa integrasi gateway.</p>@endif
<p class="center template-text">{{ $settings['receipt_footer'] ?? "Terima kasih sudah singgah.\nSuwanting Coffee" }}</p>
<button type="button" onclick="window.print()">{{ $preview?'Cetak contoh':'Cetak struk' }}</button>
@if(!$preview && ($settings['receipt_auto_print'] ?? true))<script>window.addEventListener('load',()=>window.print())</script>@endif
</body></html>
