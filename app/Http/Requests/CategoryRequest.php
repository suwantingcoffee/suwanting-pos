<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CategoryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('manage-catalog') ?? false;
    }

    public function rules(): array
    {
        return ['name' => ['required', 'string', 'max:80', Rule::unique('categories')->ignore($this->route('category'))], 'is_active' => ['required', 'boolean']];
    }
}
