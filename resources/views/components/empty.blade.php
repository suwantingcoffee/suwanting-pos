@props(['title'=>'Belum ada data','description'=>'Data akan tampil di sini setelah ditambahkan.'])
<div {{ $attributes->class(['py-12 text-center']) }}><i data-lucide="coffee" class="mx-auto mb-4 size-9 text-brand" aria-hidden="true"></i><h3 class="font-semibold">{{ $title }}</h3><p class="mt-2 text-sm text-stone-500">{{ $description }}</p>{{ $slot }}</div>
