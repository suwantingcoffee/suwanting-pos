<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="csrf-token" content="{{ csrf_token() }}">
<title>@yield('title','Dashboard') · Suwanting Coffee POS</title>
<script>try{document.documentElement.classList.toggle('dark',localStorage.getItem('suwanting-theme')==='dark')}catch{}</script>
@vite(['resources/css/app.css','resources/js/app.js'])</head>
<body x-data="{sidebar:false}" class="min-h-screen">
<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-white focus:p-4">Lewati ke konten</a>
<div x-cloak x-show="sidebar" @click="sidebar=false" class="fixed inset-0 z-30 bg-black/40 lg:hidden"></div>
<aside class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-stone-200 bg-white p-5 transition-transform dark:border-stone-700 dark:bg-stone-900 lg:translate-x-0" :class="sidebar?'translate-x-0':'-translate-x-full'">
<a href="{{ route('dashboard') }}" class="flex items-center gap-3 px-2 py-4"><span class="flex size-11 items-center justify-center rounded-2xl bg-brand text-white"><i data-lucide="coffee"></i></span><span><b class="text-lg">Suwanting</b><span class="block text-[10px] tracking-[.24em] text-stone-500">COFFEE · POINT OF SALE</span></span></a>
<p class="mb-3 mt-8 px-3 text-[10px] font-semibold tracking-[.2em] text-stone-400">RUANG KERJA</p>
<nav class="min-h-0 flex-1 overflow-y-auto grid content-start gap-2" aria-label="Menu utama">
@foreach([['dashboard','layout-dashboard','Dashboard'],['pos.index','shopping-bag','Kasir'],['transactions.index','receipt-text','Transaksi']] as [$route,$icon,$label])
<a href="{{ route($route) }}" @class(['nav-link','active'=>request()->routeIs($route)])><i data-lucide="{{ $icon }}" class="size-5"></i>{{ $label }}</a>
@endforeach
<a href="{{ route('customers.index') }}" @class(['nav-link','active'=>request()->routeIs('customers.*')])><i data-lucide="user-plus" class="size-5"></i>Pelanggan</a>
@can('manage-catalog')
<a href="{{ route('products.index') }}" @class(['nav-link','active'=>request()->routeIs('products.*')])><i data-lucide="package" class="size-5"></i>Produk & menu</a>
<a href="{{ route('categories.index') }}" @class(['nav-link','active'=>request()->routeIs('categories.*')])><i data-lucide="tags" class="size-5"></i>Kategori</a>
@endcan
@can('manage-inventory')
<a href="{{ route('inventory.ingredients.index') }}" @class(['nav-link','active'=>request()->routeIs('inventory.*')])><i data-lucide="warehouse" class="size-5"></i>Inventori & resep</a>
@endcan
@if(auth()->user()->isOwner())
<p class="mt-5 px-3 text-[10px] font-semibold tracking-[.2em] text-stone-400">KELOLA TOKO</p>
@foreach([['reports.index','chart-no-axes-combined','Laporan'],['users.index','users','Pengguna'],['audit.index','history','Audit aktivitas'],['settings.edit','settings','Pengaturan']] as [$route,$icon,$label])
<a href="{{ route($route) }}" @class(['nav-link','active'=>request()->routeIs($route)])><i data-lucide="{{ $icon }}" class="size-5"></i>{{ $label }}</a>
@endforeach
@endif
</nav>
<div class="mt-auto border-t border-stone-100 pt-5 dark:border-stone-700"><p class="truncate text-sm font-semibold">{{ auth()->user()->name }}</p><p class="mt-1 text-xs capitalize text-stone-500">{{ auth()->user()->role }}</p><form method="POST" action="{{ route('logout') }}" class="mt-4">@csrf<x-button variant="secondary" class="w-full"><i data-lucide="log-out" class="size-4"></i>Keluar</x-button></form></div>
</aside>
<div class="lg:pl-64">
<header class="sticky top-0 z-20 flex h-20 items-center justify-between gap-3 border-b border-stone-200 bg-white/95 px-4 backdrop-blur-sm dark:border-stone-700 dark:bg-stone-900/95 md:px-8">
<div class="flex items-center gap-3"><button type="button" @click="sidebar=!sidebar" class="btn btn-secondary p-2.5 lg:hidden" aria-label="Buka navigasi"><i data-lucide="menu" class="size-5"></i></button><span class="text-sm"><span class="hidden text-stone-400 sm:inline">Suwanting Coffee / </span>@yield('title','Dashboard')</span></div>
<div class="flex items-center gap-3"><span class="hidden text-xs text-stone-500 md:block">{{ now()->translatedFormat('l, d M Y') }}</span><button data-theme-toggle type="button" class="btn btn-secondary p-2.5" aria-label="Ganti tema"><i data-lucide="sun-moon" class="size-5"></i></button><span class="flex size-10 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-orange-700">{{ mb_substr(auth()->user()->name,0,1) }}</span></div>
</header>
<main id="main" class="mx-auto max-w-[1600px] p-4 pb-28 md:p-8 lg:pb-8">
@if(config('pos.demo_mode'))<div class="mb-6 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><i data-lucide="flask-conical" class="size-4 shrink-0"></i>Mode demo · Katalog dan transaksi contoh merupakan simulasi. QRIS/transfer belum terhubung payment gateway.</div>@endif
@if(session('success'))<x-toast>{{ session('success') }}</x-toast>@endif
@if($errors->any())<div role="alert" class="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><b>Periksa kembali isian.</b><ul class="mt-2 list-inside list-disc">@foreach($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul></div>@endif
@yield('content')
</main>
<nav class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-stone-200 bg-white p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] dark:border-stone-700 dark:bg-stone-900 lg:hidden" aria-label="Navigasi cepat">
@foreach([['dashboard','layout-dashboard','Home'],['pos.index','shopping-bag','Kasir'],['transactions.index','receipt-text','Transaksi'],['customers.index','user-plus','Pelanggan']] as [$route,$icon,$label])
<a href="{{ route($route) }}" class="flex flex-col items-center gap-1 rounded-xl p-2 text-xs {{ request()->routeIs($route)?'bg-orange-50 text-brand dark:bg-orange-950/40':'text-stone-500' }}"><i data-lucide="{{ $icon }}" class="size-5"></i>{{ $label }}</a>@endforeach</nav>
</div>
<x-modal id="confirm-dialog" title="Konfirmasi tindakan"><p id="confirm-message" class="text-sm text-stone-500"></p><div class="mt-6 flex justify-end gap-3"><button type="button" data-confirm-cancel class="btn btn-secondary">Batal</button><button type="button" data-confirm-accept class="btn btn-danger">Lanjutkan</button></div></x-modal>
@stack('scripts')
</body></html>
