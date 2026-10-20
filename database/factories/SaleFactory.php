<?php

namespace Database\Factories;

use App\Models\Sale;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

class SaleFactory extends Factory
{
    protected $model = Sale::class;

    public function definition(): array
    {
        return ['user_id' => User::factory(), 'invoice_number' => 'SW-'.fake()->unique()->numerify('######'), 'customer_name' => 'Pelanggan umum', 'status' => 'paid', 'subtotal' => '24000.00', 'discount' => '0.00', 'tax_rate' => '0.00', 'tax_amount' => '0.00', 'total' => '24000.00', 'idempotency_key' => fake()->unique()->uuid(), 'request_hash' => hash('sha256', fake()->uuid()), 'is_demo' => true];
    }
}
