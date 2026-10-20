<?php

namespace Database\Factories;

use App\Models\Product;
use Illuminate\Database\Eloquent\Factories\Factory;

class ProductVariantFactory extends Factory
{
    public function definition(): array
    {
        return ['product_id' => Product::factory(), 'name' => 'Iced', 'sku' => fake()->unique()->bothify('VAR-######??'),
            'price_adjustment' => '2000.00', 'is_active' => true];
    }
}
