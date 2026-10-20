@props(['name','label'])
<label class="block text-sm font-medium">{{ $label }}<select name="{{ $name }}" {{ $attributes->class(['field','mt-2']) }}>{{ $slot }}</select>
@error($name)<span class="mt-1 block text-xs text-red-600">{{ $message }}</span>@enderror</label>
