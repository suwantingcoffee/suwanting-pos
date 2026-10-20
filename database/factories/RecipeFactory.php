<?php

namespace Database\Factories;

use App\Models\Product;
use Illuminate\Database\Eloquent\Factories\Factory;

class RecipeFactory extends Factory
{
    public function definition(): array
    {
        return ['product_id' => Product::factory(), 'product_variant_id' => null, 'variant_key' => 0, 'is_active' => true];
    }
}
