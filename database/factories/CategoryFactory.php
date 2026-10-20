<?php

namespace Database\Factories;

use App\Models\Category;
use Illuminate\Database\Eloquent\Factories\Factory;

class CategoryFactory extends Factory
{
    protected $model = Category::class;

    public function definition(): array
    {
        $name = fake()->unique()->word();

        return ['name' => $name, 'slug' => str($name)->slug()->toString(), 'is_active' => true];
    }
}
