<?php

namespace Tests\Feature;

use App\Models\Ingredient;
use App\Models\InventoryUnit;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Recipe;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\User;
use App\Services\InventoryService;
use Database\Seeders\InventorySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class InventoryTest extends TestCase
{
    use RefreshDatabase;

    private function ingredient(User $owner, string $stock = '1000.000'): Ingredient
    {
        $ingredient = Ingredient::factory()->create(['name' => 'Biji kopi', 'minimum_stock' => '100.000']);
        if ($stock !== '0') {
            app(InventoryService::class)->adjust($owner, $ingredient, [
                'idempotency_key' => (string) Str::uuid(), 'type' => 'receipt',
                'quantity' => $stock, 'reference' => 'OPEN-TEST', 'reason' => 'Stok awal pengujian',
            ]);
        }

        return $ingredient->fresh();
    }

    private function recipe(Product $product, Ingredient $ingredient, string $quantity = '18.125', ?ProductVariant $variant = null): Recipe
    {
        $recipe = Recipe::factory()->create(['product_id' => $product->id, 'product_variant_id' => $variant?->id, 'variant_key' => $variant?->id ?? 0]);
        $recipe->items()->create(['ingredient_id' => $ingredient->id, 'quantity' => $quantity]);

        return $recipe;
    }

    private function checkout(Product $product, array $overrides = []): array
    {
        return array_replace([
            'idempotency_key' => (string) Str::uuid(),
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
            'payment_method' => 'cash', 'amount_received' => '1000000',
            'discount' => '0', 'payment_confirmed' => false,
        ], $overrides);
    }

    public static function inventoryPermissions(): array
    {
        return [
            'owner' => ['owner', false, true, true],
            'permitted admin' => ['admin', true, true, true],
            'restricted admin' => ['admin', false, true, false],
            'cashier' => ['cashier', true, true, false],
            'inactive owner' => ['owner', true, false, false],
        ];
    }

    #[DataProvider('inventoryPermissions')]
    public function test_inventory_gate_checks_role_permission_and_active_status(string $role, bool $catalog, bool $active, bool $allowed): void
    {
        $user = User::factory()->create(['role' => $role, 'can_manage_catalog' => $catalog, 'is_active' => $active]);

        $this->assertSame($allowed, Gate::forUser($user)->allows('manage-inventory'));
    }

    public function test_inventory_redirects_guests_and_refuses_cashier_writes(): void
    {
        $this->get('/inventory/ingredients')->assertRedirect(route('login'));
        $ingredient = Ingredient::factory()->create();
        $this->actingAs(User::factory()->create());
        foreach (['ingredients', 'units', 'recipes', 'movements', 'usage'] as $page) {
            $this->get('/inventory/'.$page)->assertForbidden();
        }
        $this->post('/inventory/ingredients', [])->assertForbidden();
        $this->post('/inventory/units', [])->assertForbidden();
        $this->post('/inventory/recipes', [])->assertForbidden();
        $this->post('/inventory/ingredients/'.$ingredient->id.'/stock', [])->assertForbidden();
        $this->assertDatabaseCount('stock_movements', 0);
    }

    public function test_admin_without_permission_is_forbidden_from_inventory(): void
    {
        $this->actingAs(User::factory()->admin()->create(['can_manage_catalog' => false]))
            ->get('/inventory/ingredients')->assertForbidden();
    }

    public function test_inventory_pages_render_for_permitted_admin(): void
    {
        $admin = User::factory()->admin()->create();
        $ingredient = $this->ingredient($admin);
        $product = Product::factory()->create();
        $recipe = $this->recipe($product, $ingredient);
        $this->actingAs($admin);

        foreach (['ingredients', 'ingredients/create', 'ingredients/'.$ingredient->id.'/edit',
            'ingredients/'.$ingredient->id.'/stock', 'units', 'units/create', 'units/'.$ingredient->inventory_unit_id.'/edit',
            'recipes', 'recipes/create', 'recipes/'.$recipe->id.'/edit', 'movements', 'usage'] as $path) {
            $this->get('/inventory/'.$path)->assertOk();
        }
    }

    public function test_unit_and_ingredient_crud_audit_and_guard_stock_assignment(): void
    {
        $owner = User::factory()->owner()->create();
        $this->actingAs($owner)->post('/inventory/units', ['name' => 'Gram', 'symbol' => 'g'])
            ->assertRedirect(route('inventory.units.index'));
        $unit = InventoryUnit::firstOrFail();
        $this->put('/inventory/units/'.$unit->id, ['name' => 'Gram bahan', 'symbol' => 'gr'])->assertRedirect();
        $data = ['name' => 'Espresso blend', 'sku' => 'RAW-ESP', 'inventory_unit_id' => $unit->id,
            'minimum_stock' => '10.125', 'is_active' => true, 'stock_quantity' => '90000'];
        $this->post('/inventory/ingredients', $data)->assertRedirect(route('inventory.ingredients.index'));
        $ingredient = Ingredient::firstOrFail();

        $this->assertSame('0.000', $ingredient->stock_quantity);
        $this->assertSame('10.125', $ingredient->minimum_stock);
        $this->put('/inventory/ingredients/'.$ingredient->id, array_replace($data, ['name' => 'Blend baru']))
            ->assertRedirect();
        $this->assertDatabaseHas('ingredients', ['id' => $ingredient->id, 'name' => 'Blend baru', 'stock_quantity' => 0]);
        $this->assertDatabaseHas('audit_logs', ['user_id' => $owner->id, 'action' => 'ingredient.saved']);
        $this->delete('/inventory/units/'.$unit->id)->assertSessionHasErrors('unit');
        $this->put('/inventory/units/'.$unit->id, ['name' => 'Gram', 'symbol' => 'kg'])->assertSessionHasErrors('symbol');
        $other = InventoryUnit::factory()->create();
        $this->put('/inventory/ingredients/'.$ingredient->id, array_replace($data, ['inventory_unit_id' => $other->id]))
            ->assertSessionHasErrors('inventory_unit_id');
        $this->delete('/inventory/ingredients/'.$ingredient->id)->assertRedirect();
        $this->assertSoftDeleted($ingredient);
        $empty = InventoryUnit::factory()->create();
        $this->delete('/inventory/units/'.$empty->id)->assertRedirect();
        $this->assertModelMissing($empty);
    }

    public function test_stock_receipts_and_adjustments_require_reason_and_are_idempotent(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = Ingredient::factory()->create();
        $this->actingAs($owner);
        $url = '/inventory/ingredients/'.$ingredient->id.'/stock';
        $data = ['idempotency_key' => (string) Str::uuid(), 'type' => 'receipt', 'quantity' => '10.125',
            'reason' => 'Penerimaan pemasok', 'reference' => 'SJ-100'];
        $this->post($url, $data)->assertRedirect();
        $this->post($url, $data)->assertRedirect();

        $this->assertSame('10.125', $ingredient->fresh()->stock_quantity);
        $this->assertDatabaseCount('stock_movements', 1);
        $this->assertDatabaseHas('stock_movements', ['user_id' => $owner->id, 'quantity' => 10.125,
            'stock_before' => 0, 'stock_after' => 10.125, 'reference' => 'SJ-100']);
        $this->postJson($url, array_replace($data, ['quantity' => '20']))->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
        $this->postJson($url, ['type' => 'adjustment', 'quantity' => '1'])->assertUnprocessable()->assertJsonValidationErrors(['idempotency_key', 'reason', 'direction']);
        $this->post($url, ['idempotency_key' => (string) Str::uuid(), 'type' => 'adjustment', 'quantity' => '0.126',
            'direction' => 'remove', 'reason' => 'Tumpah saat persiapan'])->assertRedirect();

        $this->assertSame('9.999', $ingredient->fresh()->stock_quantity);
        $this->assertDatabaseHas('stock_movements', ['type' => 'adjustment', 'quantity' => -0.126, 'stock_before' => 10.125, 'stock_after' => 9.999]);
        $this->postJson($url, ['idempotency_key' => (string) Str::uuid(), 'type' => 'adjustment', 'quantity' => '10',
            'direction' => 'remove', 'reason' => 'Stok opname'])->assertUnprocessable()->assertJsonValidationErrors('quantity');
        $this->assertSame('9.999', $ingredient->fresh()->stock_quantity);
        $this->assertDatabaseCount('stock_movements', 2);
    }

    public static function invalidQuantities(): array
    {
        return ['negative' => ['-1'], 'zero' => ['0'], 'precision' => ['0.0001'], 'scientific' => ['1e3'], 'comma' => ['1,5']];
    }

    #[DataProvider('invalidQuantities')]
    public function test_invalid_stock_quantities_return_422_without_mutation(string $quantity): void
    {
        $ingredient = Ingredient::factory()->create();

        $this->actingAs(User::factory()->owner()->create())->postJson('/inventory/ingredients/'.$ingredient->id.'/stock', [
            'idempotency_key' => (string) Str::uuid(), 'type' => 'receipt', 'quantity' => $quantity,
            'reason' => 'Penerimaan bahan', 'reference' => 'SJ-INVALID',
        ])->assertUnprocessable()->assertJsonValidationErrors('quantity');

        $this->assertSame('0.000', $ingredient->fresh()->stock_quantity);
        $this->assertDatabaseCount('stock_movements', 0);
    }

    public function test_stock_capacity_overflow_is_rejected_without_side_effects(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = $this->ingredient($owner, '999999999.999');

        $this->actingAs($owner)->postJson('/inventory/ingredients/'.$ingredient->id.'/stock', [
            'idempotency_key' => (string) Str::uuid(), 'type' => 'receipt', 'quantity' => '0.001',
            'reason' => 'Tambahan bahan', 'reference' => 'SJ-OVER',
        ])->assertUnprocessable()->assertJsonValidationErrors('quantity');

        $this->assertSame('999999999.999', $ingredient->fresh()->stock_quantity);
        $this->assertDatabaseCount('stock_movements', 1);
    }

    public function test_recipe_crud_rejects_duplicate_targets_and_foreign_variants(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = $this->ingredient($owner);
        $product = Product::factory()->create();
        $foreignVariant = ProductVariant::factory()->create();
        $data = ['product_id' => $product->id, 'is_active' => true,
            'items' => [['ingredient_id' => $ingredient->id, 'quantity' => '18.125']]];
        $this->actingAs($owner)->postJson('/inventory/recipes', [...$data, 'product_variant_id' => $foreignVariant->id])
            ->assertUnprocessable()->assertJsonValidationErrors('product_variant_id');
        $this->post('/inventory/recipes', $data)->assertRedirect(route('inventory.recipes.index'));
        $recipe = Recipe::firstOrFail();
        $this->postJson('/inventory/recipes', $data)->assertUnprocessable()->assertJsonValidationErrors('product_id');
        $data['items'][0]['quantity'] = '20.375';
        $this->put('/inventory/recipes/'.$recipe->id, $data)->assertRedirect();
        $this->assertDatabaseHas('recipe_items', ['recipe_id' => $recipe->id, 'ingredient_id' => $ingredient->id, 'quantity' => 20.375]);
        $this->delete('/inventory/recipes/'.$recipe->id)->assertRedirect();
        $this->assertDatabaseHas('recipes', ['id' => $recipe->id, 'is_active' => false]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'recipe.deactivated', 'user_id' => $owner->id]);
    }

    public function test_recipe_rejects_duplicate_ingredients_empty_items_and_zero_quantity(): void
    {
        $ingredient = Ingredient::factory()->create();
        $product = Product::factory()->create();
        $this->actingAs(User::factory()->owner()->create());
        $base = ['product_id' => $product->id, 'is_active' => true];
        $this->postJson('/inventory/recipes', [...$base, 'items' => []])->assertUnprocessable()->assertJsonValidationErrors('items');
        $this->postJson('/inventory/recipes', [...$base, 'items' => [['ingredient_id' => $ingredient->id, 'quantity' => '0']]])
            ->assertUnprocessable()->assertJsonValidationErrors('items.0.quantity');
        $this->postJson('/inventory/recipes', [...$base, 'items' => [
            ['ingredient_id' => $ingredient->id, 'quantity' => '1'], ['ingredient_id' => $ingredient->id, 'quantity' => '2'],
        ]])->assertUnprocessable()->assertJsonValidationErrors('items.0.ingredient_id');
        $this->assertDatabaseCount('recipes', 0);
    }

    public function test_paid_checkout_consumes_exact_recipe_once_with_actor_and_invoice(): void
    {
        $owner = User::factory()->owner()->create();
        $cashier = User::factory()->create();
        $ingredient = $this->ingredient($owner);
        $product = Product::factory()->create();
        $this->recipe($product, $ingredient);
        $payload = $this->checkout($product);
        $this->actingAs($cashier)->postJson('/pos/checkout', $payload)->assertOk();
        $this->postJson('/pos/checkout', $payload)->assertOk();
        $sale = Sale::firstOrFail();

        $this->assertSame('963.750', $ingredient->fresh()->stock_quantity);
        $this->assertNotNull($sale->inventory_deducted_at);
        $this->assertDatabaseCount('sales', 1);
        $this->assertDatabaseCount('stock_movements', 2);
        $this->assertDatabaseHas('stock_movements', ['type' => 'consumption', 'sale_id' => $sale->id,
            'sale_item_id' => $sale->items->first()->id, 'user_id' => $cashier->id, 'quantity' => -36.25,
            'reference' => $sale->invoice_number, 'stock_before' => 1000, 'stock_after' => 963.75]);
        $this->assertDatabaseHas('sale_item_ingredients', ['ingredient_id' => $ingredient->id, 'quantity' => 36.25]);
    }

    public function test_insufficient_shared_ingredient_rolls_back_every_checkout_write(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = $this->ingredient($owner, '25');
        $other = $this->ingredient($owner, '100');
        $first = Product::factory()->create();
        $second = Product::factory()->create();
        $recipe = $this->recipe($first, $ingredient, '15');
        $recipe->items()->create(['ingredient_id' => $other->id, 'quantity' => '2']);
        $this->recipe($second, $ingredient, '15');

        $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $this->checkout($first, [
            'items' => [['product_id' => $first->id, 'quantity' => 1], ['product_id' => $second->id, 'quantity' => 1]],
        ]))->assertUnprocessable()->assertJsonValidationErrors('items');

        $this->assertSame('25.000', $ingredient->fresh()->stock_quantity);
        $this->assertSame('100.000', $other->fresh()->stock_quantity);
        $this->assertDatabaseCount('sales', 0);
        $this->assertDatabaseCount('sale_items', 0);
        $this->assertDatabaseCount('sale_item_ingredients', 0);
        $this->assertDatabaseCount('payments', 0);
        $this->assertDatabaseCount('stock_movements', 2);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'sale.checkout']);
    }

    public function test_failed_payment_keeps_stock_and_snapshots_unchanged(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = $this->ingredient($owner);
        $product = Product::factory()->create();
        $this->recipe($product, $ingredient);

        $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $this->checkout($product, ['amount_received' => '1']))
            ->assertUnprocessable()->assertJsonValidationErrors('amount_received');

        $this->assertSame('1000.000', $ingredient->fresh()->stock_quantity);
        $this->assertDatabaseCount('sales', 0);
        $this->assertDatabaseCount('sale_item_ingredients', 0);
        $this->assertDatabaseCount('stock_movements', 1);
    }

    public function test_variant_recipe_replaces_base_and_inactive_variant_falls_back(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = $this->ingredient($owner);
        $product = Product::factory()->create();
        $variant = ProductVariant::factory()->create(['product_id' => $product->id]);
        $this->recipe($product, $ingredient, '10');
        $variantRecipe = $this->recipe($product, $ingredient, '15', $variant);
        $payload = $this->checkout($product, ['items' => [['product_id' => $product->id, 'variant_id' => $variant->id, 'quantity' => 2]]]);
        $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $payload)->assertOk();
        $this->assertSame('970.000', $ingredient->fresh()->stock_quantity);
        $variantRecipe->update(['is_active' => false]);
        $payload['idempotency_key'] = (string) Str::uuid();
        $this->postJson('/pos/checkout', $payload)->assertOk();
        $this->assertSame('950.000', $ingredient->fresh()->stock_quantity);
    }

    public function test_exception_after_stock_write_rolls_back_balance_movement_payment_and_sale(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = $this->ingredient($owner);
        $product = Product::factory()->create();
        $this->recipe($product, $ingredient);
        Exceptions::fake();
        $event = 'eloquent.created: '.StockMovement::class;
        Event::listen($event, function (StockMovement $movement): void {
            if ($movement->type === 'consumption') {
                throw new RuntimeException('Simulasi kegagalan setelah mutasi tersimpan.');
            }
        });

        try {
            $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $this->checkout($product))
                ->assertInternalServerError();

            $this->assertSame('1000.000', $ingredient->fresh()->stock_quantity);
            $this->assertDatabaseCount('stock_movements', 1);
            $this->assertDatabaseCount('sales', 0);
            $this->assertDatabaseCount('sale_items', 0);
            $this->assertDatabaseCount('payments', 0);
            $this->assertDatabaseCount('sale_item_ingredients', 0);
            $this->assertDatabaseMissing('audit_logs', ['action' => 'inventory.consumption']);
            Exceptions::assertReported(RuntimeException::class);
        } finally {
            Event::forget($event);
        }
    }

    public function test_inactive_base_recipe_leaves_catalog_product_sellable_without_consumption(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = $this->ingredient($owner);
        $product = Product::factory()->create();
        $recipe = $this->recipe($product, $ingredient);
        $recipe->update(['is_active' => false]);

        $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $this->checkout($product))->assertOk();

        $this->assertSame('1000.000', $ingredient->fresh()->stock_quantity);
        $this->assertDatabaseCount('sale_item_ingredients', 0);
        $this->assertDatabaseCount('stock_movements', 1);
    }

    public function test_empty_active_recipe_blocks_checkout_instead_of_skipping_inventory(): void
    {
        $product = Product::factory()->create();
        Recipe::factory()->create(['product_id' => $product->id]);

        $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $this->checkout($product))
            ->assertUnprocessable()->assertJsonValidationErrors('items');

        $this->assertDatabaseCount('sales', 0);
        $this->assertDatabaseCount('stock_movements', 0);
    }

    public function test_pending_payment_uses_checkout_recipe_snapshot_when_confirmed_once(): void
    {
        $owner = User::factory()->owner()->create();
        $cashier = User::factory()->create();
        $ingredient = $this->ingredient($owner);
        $product = Product::factory()->create();
        $recipe = $this->recipe($product, $ingredient, '18.125');
        $this->actingAs($cashier)->postJson('/pos/checkout', $this->checkout($product, ['payment_method' => 'qris']))
            ->assertOk();
        $sale = Sale::firstOrFail();
        $this->assertSame('1000.000', $ingredient->fresh()->stock_quantity);
        $this->assertNull($sale->inventory_deducted_at);
        $recipe->items()->update(['quantity' => '500']);
        $recipe->update(['is_active' => false]);

        $this->actingAs($owner)->post('/transactions/'.$sale->id.'/confirm', ['confirmed' => true])->assertRedirect();
        $this->post('/transactions/'.$sale->id.'/confirm', ['confirmed' => true])->assertRedirect();

        $this->assertSame('963.750', $ingredient->fresh()->stock_quantity);
        $this->assertSame('paid', $sale->fresh()->status);
        $this->assertDatabaseCount('stock_movements', 2);
        $this->assertDatabaseHas('stock_movements', ['type' => 'consumption', 'user_id' => $owner->id, 'quantity' => -36.25]);
    }

    public function test_confirmation_with_insufficient_stock_leaves_payment_pending(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = $this->ingredient($owner, '10');
        $product = Product::factory()->create();
        $this->recipe($product, $ingredient, '15');
        $cashier = User::factory()->create();
        $this->actingAs($cashier)->postJson('/pos/checkout', $this->checkout($product, ['payment_method' => 'transfer']))->assertOk();
        $sale = Sale::firstOrFail();

        $this->postJson('/transactions/'.$sale->id.'/confirm', ['confirmed' => true])->assertUnprocessable()->assertJsonValidationErrors('items');

        $this->assertSame('pending', $sale->fresh()->status);
        $this->assertSame('pending', $sale->payment->status);
        $this->assertSame('0.00', $sale->payment->amount_received);
        $this->assertNull($sale->inventory_deducted_at);
        $this->assertSame('10.000', $ingredient->fresh()->stock_quantity);
        $this->assertDatabaseCount('stock_movements', 1);
        $this->assertDatabaseMissing('audit_logs', ['action' => 'payment.simulated_confirmation']);
    }

    public function test_inactive_ingredient_blocks_checkout_and_cannot_be_archived_while_used(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = $this->ingredient($owner);
        $product = Product::factory()->create();
        $this->recipe($product, $ingredient);
        $this->actingAs($owner)->delete('/inventory/ingredients/'.$ingredient->id)->assertSessionHasErrors('ingredient');
        $ingredient->update(['is_active' => false]);

        $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $this->checkout($product))
            ->assertUnprocessable()->assertJsonValidationErrors('items');

        $this->assertSame('1000.000', $ingredient->fresh()->stock_quantity);
        $this->assertDatabaseCount('sales', 0);
    }

    public function test_low_stock_filter_usage_date_filters_and_escaping(): void
    {
        $this->travelTo(now()->setDate(2026, 10, 20)->setTime(10, 0));
        $owner = User::factory()->owner()->create();
        $ingredient = $this->ingredient($owner, '100');
        $ingredient->update(['name' => '<script>alert(1)</script>']);
        $plentiful = $this->ingredient($owner, '9999');
        $plentiful->update(['name' => 'Plentiful unique']);
        $product = Product::factory()->create();
        $this->recipe($product, $ingredient, '10.125');
        $this->actingAs($owner)->postJson('/pos/checkout', $this->checkout($product))->assertOk();

        $this->get('/inventory/ingredients?low=1')->assertOk()->assertSee('1 bahan mencapai stok minimum.')
            ->assertSee('&lt;script&gt;', false)->assertDontSee('<script>alert(1)</script>', false)->assertDontSee('Plentiful unique');
        $this->get('/inventory/usage?from=2026-10-20&to=2026-10-20')->assertOk()->assertSee('20.25')->assertSee('Pemakaian bahan');
        $this->get('/inventory/usage?from=2026-10-21')->assertOk()->assertSee('Belum ada pemakaian');
        $this->get('/inventory/movements?type=consumption&ingredient_id='.$ingredient->id)->assertOk()->assertSee(Sale::firstOrFail()->invoice_number)->assertDontSee('OPEN-TEST');
        $this->getJson('/inventory/usage?from=2026-10-21&to=2026-10-20')->assertUnprocessable()->assertJsonValidationErrors('to');
    }

    public function test_inventory_seeder_preserves_modified_stock_recipes_and_does_not_backfill_old_sales(): void
    {
        $this->seed();
        $ingredient = Ingredient::where('sku', 'DEMO-ESPRESSO')->firstOrFail();
        $recipe = Recipe::where('product_id', Product::where('sku', 'ESP-001')->value('id'))->firstOrFail();
        $recipe->items()->update(['quantity' => '19.750']);
        $owner = User::where('email', 'owner@suwanting.test')->firstOrFail();
        app(InventoryService::class)->adjust($owner, $ingredient, [
            'idempotency_key' => (string) Str::uuid(), 'type' => 'adjustment', 'direction' => 'remove',
            'quantity' => '1.125', 'reason' => 'Koreksi stok demo',
        ]);

        $this->seed(InventorySeeder::class);

        $this->assertSame('9998.875', $ingredient->fresh()->stock_quantity);
        $this->assertSame('19.750', $recipe->items()->first()->quantity);
        $this->assertDatabaseCount('stock_movements', 9);
        $this->assertDatabaseCount('sale_item_ingredients', 0);
        $this->assertDatabaseCount('sales', 8);
    }
}
