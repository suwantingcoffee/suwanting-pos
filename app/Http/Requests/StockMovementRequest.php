<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StockMovementRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('manage-inventory') ?? false;
    }

    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'uuid'],
            'type' => ['required', 'in:receipt,adjustment'],
            'direction' => ['required_if:type,adjustment', 'nullable', 'in:add,remove'],
            'quantity' => ['required', 'regex:/^\d{1,9}(?:\.\d{1,3})?$/D', 'numeric', 'gt:0'],
            'reference' => ['required_if:type,receipt', 'nullable', 'string', 'max:120'],
            'reason' => ['required', 'string', 'min:3', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return ['reason.required' => 'Alasan mutasi wajib diisi.',
            'quantity.regex' => 'Jumlah memakai maksimal tiga angka desimal dan tidak boleh negatif.',
            'quantity.gt' => 'Jumlah mutasi harus lebih dari nol.',
            'reference.required_if' => 'Referensi penerimaan wajib diisi.'];
    }
}
