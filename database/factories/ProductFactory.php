<?php

namespace Database\Factories;

use App\Models\Category;
use App\Models\Product;
use Illuminate\Database\Eloquent\Factories\Factory;

class ProductFactory extends Factory
{
    protected $model = Product::class;

    public function definition(): array
    {
        return ['category_id' => Category::factory(), 'name' => fake()->words(2, true), 'sku' => fake()->unique()->bothify('SKU-####'), 'product_type' => 'drink', 'selling_price' => '24000.00', 'cost_price' => '9000.00', 'description' => fake()->sentence(), 'is_active' => true];
    }
}
