@props(['id','title'])
<dialog id="{{ $id }}" class="modal w-[calc(100%-2rem)] max-w-md rounded-2xl border border-stone-200 bg-white p-6 text-stone-900 shadow-xl backdrop:bg-black/45 dark:border-stone-700 dark:bg-stone-900 dark:text-white">
<h2 class="mb-3 text-xl font-semibold">{{ $title }}</h2>{{ $slot }}
</dialog>
