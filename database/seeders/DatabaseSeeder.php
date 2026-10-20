<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Setting;
use App\Models\User;
use App\Services\CheckoutService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment(['local', 'testing']) || ! config('pos.demo_mode')) {
            throw new RuntimeException('Seeder demo hanya boleh dijalankan pada development/testing dengan POS_DEMO_MODE=true.');
        }
        $users = [];
        foreach (['owner' => 'Owner', 'admin' => 'Admin', 'cashier' => 'Kasir'] as $role => $name) {
            $email = ($role === 'cashier' ? 'kasir' : $role).'@suwanting.test';
            $users[$role] = User::firstOrCreate(['email' => $email], [
                'name' => $name.' Suwanting', 'password' => Hash::make('SuwantingDemo!2026'),
                'role' => $role, 'is_active' => true, 'can_manage_catalog' => $role !== 'cashier', 'can_discount' => $role !== 'cashier',
            ]);
        }
        foreach (array_replace(Setting::DEFAULTS, ['shop_address' => 'Suwanting, Indonesia']) as $key => $value) {
            Setting::firstOrCreate(['key' => $key], ['value' => $value]);
        }
        $catalog = [
            ['Coffee', 'Espresso', 'ESP-001', '18000', '6000', 'drink'],
            ['Coffee', 'Americano', 'AME-001', '20000', '7000', 'drink'],
            ['Coffee', 'Kopi Susu Suwanting', 'KSS-001', '24000', '9000', 'drink'],
            ['Coffee', 'Cafe Latte', 'LAT-001', '26000', '10000', 'drink'],
            ['Manual Brew', 'V60 Merapi Natural', 'V60-MER', '28000', '12000', 'drink'],
            ['Manual Brew', 'V60 Merbabu Natural', 'V60-MEB', '28000', '12000', 'drink'],
            ['Non Coffee', 'Matcha Latte', 'MAT-001', '26000', '11000', 'drink'],
            ['Non Coffee', 'Chocolate', 'CHO-001', '23000', '9000', 'drink'],
            ['Food', 'Butter Croissant', 'CRO-001', '18000', '9000', 'food'],
            ['Food', 'Banana Bread', 'BAN-001', '16000', '7000', 'food'],
            ['Beans', 'Merapi Natural 250g', 'BEAN-MER', '85000', '45000', 'beans'],
            ['Beans', 'Merbabu Natural 250g', 'BEAN-MEB', '85000', '45000', 'beans'],
        ];
        foreach ($catalog as [$categoryName,$name,$sku,$price,$cost,$type]) {
            $category = Category::firstOrCreate(['name' => $categoryName], ['slug' => str($categoryName)->slug()->toString(), 'is_active' => true]);
            $product = Product::firstOrCreate(['sku' => $sku], ['name' => $name, 'category_id' => $category->id, 'product_type' => $type, 'selling_price' => $price, 'cost_price' => $cost, 'is_active' => true]);
            if ($product->wasRecentlyCreated && $type === 'drink') {
                foreach (['Hot' => '0.00', 'Iced' => '2000.00'] as $variant => $adjustment) {
                    $product->variants()->firstOrCreate(['name' => $variant], ['sku' => $sku.'-'.strtoupper($variant), 'price_adjustment' => $adjustment, 'is_active' => true]);
                }
            }
        }
        $product = Product::where('sku', 'KSS-001')->firstOrFail();
        foreach (range(1, 8) as $index) {
            $key = sprintf('de000000-0000-4000-8000-%012d', $index);
            if (Sale::where('idempotency_key', $key)->exists()) {
                continue;
            }
            $sale = app(CheckoutService::class)->checkout($users['cashier'], [
                'idempotency_key' => $key, 'items' => [['product_id' => $product->id, 'quantity' => ($index % 3) + 1]],
                'customer_name' => 'Pelanggan demo '.$index, 'discount' => '0',
                'payment_method' => ['cash', 'qris', 'transfer'][$index % 3],
                'payment_confirmed' => true, 'amount_received' => '100000',
            ]);
            $sale->update(['created_at' => now()->subDays($index % 7)->subHours($index)]);
        }
        $this->call(InventorySeeder::class);
        $this->call(CustomerSeeder::class);
        $this->command?->info('Data demo disiapkan tanpa menimpa record yang sudah ada. Akun dan password tercantum di README lokal.');
    }
}
