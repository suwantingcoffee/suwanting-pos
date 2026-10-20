<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class UserFactory extends Factory
{
    protected static ?string $password;

    public function definition(): array
    {
        return ['name' => fake()->name(), 'email' => fake()->unique()->safeEmail(), 'email_verified_at' => now(), 'password' => static::$password ??= Hash::make('password'), 'remember_token' => Str::random(10), 'role' => 'cashier', 'is_active' => true, 'can_manage_catalog' => false, 'can_discount' => false];
    }

    public function owner(): static
    {
        return $this->state(['role' => 'owner', 'can_manage_catalog' => true, 'can_discount' => true]);
    }

    public function admin(): static
    {
        return $this->state(['role' => 'admin', 'can_manage_catalog' => true, 'can_discount' => true]);
    }

    public function unverified(): static
    {
        return $this->state(['email_verified_at' => null]);
    }
}
