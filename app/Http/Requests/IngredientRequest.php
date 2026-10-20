<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class IngredientRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('manage-inventory') ?? false;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'sku' => ['required', 'string', 'alpha_dash', 'max:40', Rule::unique('ingredients')->ignore($this->route('ingredient'))],
            'inventory_unit_id' => ['required', 'integer', Rule::exists('inventory_units', 'id')],
            'minimum_stock' => ['required', 'regex:/^\d{1,9}(?:\.\d{1,3})?$/D'],
            'is_active' => ['required', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return ['minimum_stock.regex' => 'Stok minimum memakai maksimal tiga angka desimal dan tidak boleh negatif.'];
    }
}
