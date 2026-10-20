<div role="status" x-data="{visible:true}" x-show="visible" class="mb-5 flex items-start justify-between gap-4 rounded-xl bg-emerald-100 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
<span>{{ $slot }}</span><button type="button" @click="visible=false" class="shrink-0" aria-label="Tutup pemberitahuan">✕</button>
</div>
