<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('manage-catalog') ?? false;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'sku' => ['required', 'string', 'max:40', 'alpha_dash', Rule::unique('products', 'sku')->ignore($this->route('product'))],
            'category_id' => ['required', Rule::exists('categories', 'id')],
            'product_type' => ['required', Rule::in(['drink', 'beans', 'food'])],
            'selling_price' => ['required', 'regex:/^\d{1,8}(?:\.\d{1,2})?$/D'],
            'cost_price' => ['nullable', 'regex:/^\d{1,8}(?:\.\d{1,2})?$/D'],
            'description' => ['nullable', 'string', 'max:1000'],
            'is_active' => ['required', 'boolean'],
            'photo' => ['nullable', 'image', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
            'variants' => ['nullable', 'array', 'max:8'],
            'variants.*.name' => ['required', 'string', 'max:80', 'distinct'],
            'variants.*.price_adjustment' => ['required', 'regex:/^\d{1,8}(?:\.\d{1,2})?$/D'],
        ];
    }
}
