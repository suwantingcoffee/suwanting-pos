<?php

namespace Database\Seeders;

use App\Models\Ingredient;
use App\Models\InventoryUnit;
use App\Models\Product;
use App\Models\Recipe;
use App\Models\User;
use App\Services\InventoryService;
use App\Services\RecipeService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class InventorySeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment(['local', 'testing']) || ! config('pos.demo_mode')) {
            throw new RuntimeException('Seeder inventori demo hanya berjalan pada development/testing dengan POS_DEMO_MODE=true.');
        }
        $owner = User::where('email', 'owner@suwanting.test')->firstOrFail();
        if (! $owner->can('manage-inventory')) {
            throw new RuntimeException('Owner demo tidak memiliki izin inventori. Data pengguna tidak diubah oleh seeder.');
        }
        DB::transaction(function () use ($owner): void {
            $units = [];
            foreach (['g' => 'Gram', 'ml' => 'Mililiter', 'pcs' => 'Buah'] as $symbol => $name) {
                $units[$symbol] = InventoryUnit::firstOrCreate(['symbol' => $symbol], ['name' => $name]);
            }
            $ingredients = [];
            foreach ([
                ['ESPRESSO', 'Biji kopi espresso blend', 'g', '10000', '1000'],
                ['MILK', 'Susu segar', 'ml', '20000', '2000'],
                ['PALM', 'Sirup gula aren', 'ml', '5000', '500'],
                ['ICE', 'Es batu', 'g', '30000', '3000'],
                ['MERAPI', 'Biji Merapi Natural', 'g', '10000', '1000'],
                ['MERBABU', 'Biji Merbabu Natural', 'g', '10000', '1000'],
                ['MATCHA', 'Bubuk matcha', 'g', '2000', '200'],
                ['CHOCO', 'Bubuk cokelat', 'g', '3000', '300'],
            ] as $index => [$sku, $name, $symbol, $opening, $minimum]) {
                $ingredient = Ingredient::withTrashed()->firstOrCreate(['sku' => 'DEMO-'.$sku], [
                    'name' => $name, 'inventory_unit_id' => $units[$symbol]->id,
                    'minimum_stock' => $minimum, 'is_active' => true,
                ]);
                $ingredients[$sku] = $ingredient;
                if ($ingredient->wasRecentlyCreated) {
                    app(InventoryService::class)->adjust($owner, $ingredient, [
                        'idempotency_key' => sprintf('1a000000-0000-4000-8000-%012d', $index + 1),
                        'type' => 'receipt', 'quantity' => $opening, 'reference' => 'DEMO-OPEN-'.$sku,
                        'reason' => 'Saldo awal bahan demo (simulasi)',
                    ]);
                }
            }
            foreach ([
                'ESP-001' => ['ESPRESSO' => '18'],
                'AME-001' => ['ESPRESSO' => '18'],
                'KSS-001' => ['ESPRESSO' => '18', 'MILK' => '120', 'PALM' => '20'],
                'LAT-001' => ['ESPRESSO' => '18', 'MILK' => '180'],
                'V60-MER' => ['MERAPI' => '15'],
                'V60-MEB' => ['MERBABU' => '15'],
                'MAT-001' => ['MATCHA' => '5', 'MILK' => '180'],
                'CHO-001' => ['CHOCO' => '20', 'MILK' => '150'],
                'BEAN-MER' => ['MERAPI' => '250'],
                'BEAN-MEB' => ['MERBABU' => '250'],
            ] as $sku => $formula) {
                $product = Product::where('sku', $sku)->first();
                if (! $product) {
                    continue;
                }
                $targets = [['variant' => null, 'formula' => $formula]];
                if ($product->product_type === 'drink') {
                    $iced = $product->variants()->where('name', 'Iced')->where('is_active', true)->first();
                    if ($iced) {
                        $targets[] = ['variant' => $iced->id, 'formula' => [...$formula, 'ICE' => '100']];
                    }
                }
                foreach ($targets as $target) {
                    if (Recipe::where('product_id', $product->id)->where('variant_key', $target['variant'] ?? 0)->exists()) {
                        continue;
                    }
                    if (collect(array_keys($target['formula']))->contains(fn ($key) => ! $ingredients[$key]->is_active || $ingredients[$key]->trashed())) {
                        continue;
                    }
                    app(RecipeService::class)->save($owner, [
                        'product_id' => $product->id, 'product_variant_id' => $target['variant'], 'is_active' => true,
                        'items' => collect($target['formula'])->map(fn ($quantity, $key): array => [
                            'ingredient_id' => $ingredients[$key]->id, 'quantity' => $quantity,
                        ])->values()->all(),
                    ]);
                }
            }
        });
        $this->command?->info('Inventori demo ditambahkan; saldo, resep, dan bahan yang sudah ada tidak ditimpa.');
    }
}
