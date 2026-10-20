<?php

namespace Database\Seeders;

use App\Models\Customer;
use Illuminate\Database\Seeder;
use RuntimeException;

class CustomerSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment(['local', 'testing']) || ! config('pos.demo_mode')) {
            throw new RuntimeException('Seeder pelanggan demo hanya untuk development/testing dengan POS_DEMO_MODE=true.');
        }

        Customer::withTrashed()->firstOrCreate(['email' => 'pelanggan-demo@suwanting.test'], [
            'name' => 'Pelanggan Contoh', 'phone' => null, 'is_active' => true,
            'notes' => 'Data contoh. Dapat diarsipkan setelah mencoba pemilihan pelanggan.',
        ]);
    }
}
