<form class="card mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
<x-select name="ingredient_id" label="Bahan"><option value="">Semua bahan</option>@foreach($ingredients as $ingredient)<option value="{{ $ingredient->id }}" @selected(request('ingredient_id')==$ingredient->id)>{{ $ingredient->name }}</option>@endforeach</x-select>
<x-input name="from" label="Dari tanggal" type="date" :value="request('from')"/>
<x-input name="to" label="Sampai tanggal" type="date" :value="request('to')"/>
@if(request()->routeIs('inventory.movements.index'))
<x-select name="type" label="Jenis mutasi"><option value="">Semua jenis</option>@foreach(['receipt'=>'Stok masuk','adjustment'=>'Penyesuaian','consumption'=>'Pemakaian resep'] as $value=>$label)<option value="{{ $value }}" @selected(request('type')===$value)>{{ $label }}</option>@endforeach</x-select>
<x-input name="q" label="Cari referensi / nama bahan" :value="request('q')"/>
@endif
<div class="flex items-end gap-2"><x-button>Filter</x-button><x-button :href="route(request()->route()->getName())" variant="secondary">Reset</x-button></div>
</form>
