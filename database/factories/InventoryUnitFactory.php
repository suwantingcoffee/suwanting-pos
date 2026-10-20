<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

class InventoryUnitFactory extends Factory
{
    public function definition(): array
    {
        return ['name' => 'Gram', 'symbol' => fake()->unique()->bothify('g-####??')];
    }
}
