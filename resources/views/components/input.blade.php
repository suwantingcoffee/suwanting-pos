@props(['name','label','type'=>'text','value'=>''])
<label class="block text-sm font-medium">{{ $label }}
<input name="{{ $name }}" type="{{ $type }}" value="{{ old($name,$value) }}" {{ $attributes->class(['field','mt-2']) }}>
@error($name)<span class="mt-1 block text-xs text-red-600">{{ $message }}</span>@enderror
</label>
