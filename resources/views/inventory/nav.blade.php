<nav class="mb-6 flex gap-2 overflow-x-auto pb-2" aria-label="Menu inventori">
@foreach([['inventory.ingredients.index','Bahan baku','inventory.ingredients.*'],['inventory.units.index','Satuan dasar','inventory.units.*'],['inventory.recipes.index','Resep','inventory.recipes.*'],['inventory.movements.index','Riwayat stok','inventory.movements.*'],['inventory.usage','Pemakaian bahan','inventory.usage']] as [$route,$label,$pattern])
<a href="{{ route($route) }}" @class(['chip whitespace-nowrap','bg-brand text-white'=>request()->routeIs($pattern),'bg-white dark:bg-stone-900'=>!request()->routeIs($pattern)])>{{ $label }}</a>
@endforeach
</nav>
