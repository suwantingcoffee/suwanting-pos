<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class RecipeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('manage-inventory') ?? false;
    }

    public function rules(): array
    {
        return [
            'product_id' => ['required', 'integer', Rule::exists('products', 'id')->whereNull('deleted_at')],
            'product_variant_id' => ['nullable', 'integer', Rule::exists('product_variants', 'id')->where('product_id', $this->input('product_id'))->where('is_active', true)],
            'is_active' => ['required', 'boolean'],
            'items' => ['required', 'array', 'min:1', 'max:30'],
            'items.*' => ['required', 'array:ingredient_id,quantity'],
            'items.*.ingredient_id' => ['required', 'integer', 'distinct', Rule::exists('ingredients', 'id')->whereNull('deleted_at')->where('is_active', true)],
            'items.*.quantity' => ['required', 'regex:/^\d{1,6}(?:\.\d{1,3})?$/D', 'numeric', 'gt:0'],
        ];
    }

    public function messages(): array
    {
        return [
            'items.required' => 'Tambahkan minimal satu bahan pada resep.',
            'items.*.ingredient_id.distinct' => 'Bahan yang sama tidak boleh diulang dalam satu resep.',
            'items.*.ingredient_id.exists' => 'Pilih bahan aktif yang tersedia.',
            'items.*.quantity.regex' => 'Takaran maksimal 999999.999 dengan tiga angka desimal.',
            'items.*.quantity.gt' => 'Takaran bahan harus lebih dari nol.',
            'product_variant_id.exists' => 'Varian tidak sesuai produk atau sudah nonaktif.',
        ];
    }
}
