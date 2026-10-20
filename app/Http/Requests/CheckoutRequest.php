<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CheckoutRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        foreach (['discount', 'amount_received'] as $field) {
            $value = $this->input($field);
            if (is_int($value) || is_float($value)) {
                $this->merge([$field => (string) $value]);
            }
        }
    }

    public function authorize(): bool
    {
        return $this->user()?->canOperate() ?? false;
    }

    public function rules(): array
    {
        $money = ['regex:/^\d{1,9}(?:\.\d{1,2})?$/D'];

        return [
            'idempotency_key' => ['required', 'uuid'],
            'customer_id' => ['nullable', 'integer', 'min:1'],
            'customer_name' => ['nullable', 'string', 'max:120'],
            'items' => ['required', 'array', 'min:1', 'max:50'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.variant_id' => ['nullable', 'integer', 'min:1'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:99'],
            'items.*.notes' => ['nullable', 'string', 'max:255'],
            'discount' => ['nullable', ...$money],
            'payment_method' => ['required', 'in:cash,qris,transfer'],
            'amount_received' => ['required_if:payment_method,cash', 'nullable', ...$money],
            'payment_confirmed' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return [
            'items.required' => 'Keranjang masih kosong.',
            'items.*.quantity.min' => 'Kuantitas minimal satu.',
            'items.*.quantity.max' => 'Kuantitas maksimal 99 per item.',
            'payment_method.in' => 'Metode pembayaran tidak valid.',
            '*.regex' => 'Gunakan nominal positif dengan maksimal dua desimal.',
        ];
    }
}
