@props(['href'=>null,'variant'=>'primary','type'=>'submit'])
@if($href)
<a href="{{ $href }}" {{ $attributes->class(['btn', 'btn-'.$variant]) }}>{{ $slot }}</a>
@else
<button type="{{ $type }}" {{ $attributes->class(['btn', 'btn-'.$variant]) }}>{{ $slot }}</button>
@endif
