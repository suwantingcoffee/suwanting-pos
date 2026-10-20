<?php

namespace App\Services;

use App\Models\Payment;
use App\Models\Sale;
use Illuminate\Validation\ValidationException;

class PaymentService
{
    public function create(Sale $sale, array $data): Payment
    {
        $cash = $data['payment_method'] === 'cash';
        $total = Money::cents($sale->total);
        $confirmed = $cash || (bool) ($data['payment_confirmed'] ?? false);
        if (! $cash && ! config('pos.simulate_payments')) {
            throw ValidationException::withMessages(['payment_method' => 'Simulasi QRIS/transfer sedang dinonaktifkan. Gunakan tunai.']);
        }
        $received = $cash ? Money::cents($data['amount_received'], 'amount_received') : ($confirmed ? $total : 0);
        if ($cash && $received < $total) {
            throw ValidationException::withMessages(['amount_received' => 'Uang diterima belum mencukupi total pembayaran.']);
        }

        $sale->update(['status' => $confirmed ? 'paid' : 'pending']);

        return $sale->payment()->create([
            'method' => $data['payment_method'], 'amount_due' => $sale->total,
            'amount_received' => Money::decimal($received),
            'change_amount' => Money::decimal($cash ? $received - $total : 0),
            'status' => $confirmed ? 'paid' : 'pending',
            'is_simulated' => ! $cash || config('pos.demo_mode'),
            'paid_at' => $confirmed ? now() : null,
        ]);
    }
}
