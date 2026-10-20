<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class InventoryUnitRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('manage-inventory') ?? false;
    }

    public function rules(): array
    {
        return ['name' => ['required', 'string', 'max:80'],
            'symbol' => ['required', 'string', 'alpha_dash', 'max:20', Rule::unique('inventory_units')->ignore($this->route('unit'))]];
    }
}
