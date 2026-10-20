<?php

namespace Database\Factories;

use App\Models\InventoryUnit;
use Illuminate\Database\Eloquent\Factories\Factory;

class IngredientFactory extends Factory
{
    public function definition(): array
    {
        return ['inventory_unit_id' => InventoryUnit::factory(), 'name' => fake()->words(2, true), 'sku' => fake()->unique()->bothify('ING-####??'), 'minimum_stock' => '100.000', 'is_active' => true];
    }
}
