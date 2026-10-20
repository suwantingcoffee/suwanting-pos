<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->isOwner() ?? false;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email', 'max:255', Rule::unique('users')->ignore($this->route('user'))],
            'password' => [$this->isMethod('post') ? 'required' : 'nullable', 'string', 'min:8', 'max:255'],
            'role' => ['required', Rule::in(['owner', 'admin', 'cashier'])],
            'is_active' => ['required', 'boolean'],
            'can_discount' => ['sometimes', 'boolean'],
            'can_manage_catalog' => ['sometimes', 'boolean'],
        ];
    }
}
