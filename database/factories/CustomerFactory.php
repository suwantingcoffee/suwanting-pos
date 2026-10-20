<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

class CustomerFactory extends Factory
{
    public function definition(): array
    {
        return [
            'name' => fake()->name(), 'phone' => fake()->numerify('0812########'),
            'email' => fake()->safeEmail(), 'address' => fake()->streetAddress(),
            'notes' => null, 'is_active' => true,
        ];
    }
}
