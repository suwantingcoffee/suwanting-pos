<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->isOwner() ?? false;
    }

    public function rules(): array
    {
        return [
            'shop_name' => ['required', 'string', 'max:100'],
            'shop_address' => ['nullable', 'string', 'max:255'],
            'tax_rate' => ['required', 'numeric', 'between:0,100', 'regex:/^\d{1,3}(?:\.\d{1,2})?$/D'],
            'tax_enabled' => ['sometimes', 'boolean'],
            'shop_phone' => ['nullable', 'string', 'max:30', 'regex:/^[+0-9() .-]+$/D'],
            'shop_email' => ['nullable', 'email', 'max:120'],
            'receipt_header' => ['nullable', 'string', 'max:500'],
            'receipt_footer' => ['nullable', 'string', 'max:500'],
            'receipt_paper' => ['sometimes', 'in:58,80'],
            'receipt_show_cashier' => ['sometimes', 'boolean'],
            'receipt_show_customer' => ['sometimes', 'boolean'],
            'receipt_show_sku' => ['sometimes', 'boolean'],
            'receipt_auto_print' => ['sometimes', 'boolean'],
        ];
    }
}
