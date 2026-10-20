<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AuthAndPosTest extends TestCase
{
    use LazilyRefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
    }

    private function payload(Product $product, array $overrides = []): array
    {
        return array_replace([
            'idempotency_key' => (string) Str::uuid(),
            'items' => [['product_id' => $product->id, 'quantity' => 2, 'notes' => 'Tanpa gula']],
            'discount' => '0', 'payment_method' => 'cash', 'amount_received' => '100000',
            'payment_confirmed' => false, 'customer_name' => 'Meja 03',
        ], $overrides);
    }

    public function test_login_regenerates_session_and_logout_revokes_access(): void
    {
        $user = User::factory()->owner()->create();
        $this->post('/login', ['email' => $user->email, 'password' => 'password'])->assertRedirect(route('dashboard'));
        $this->assertAuthenticatedAs($user);
        $this->post('/logout')->assertRedirect(route('login'));
        $this->assertGuest();
        $this->get('/pos')->assertRedirect(route('login'));
    }

    public function test_wrong_password_and_inactive_user_cannot_login(): void
    {
        $user = User::factory()->create(['is_active' => false]);
        $this->post('/login', ['email' => $user->email, 'password' => 'password'])->assertSessionHasErrors('email');
        $this->assertGuest();
        $user->update(['is_active' => true]);
        $this->post('/login', ['email' => $user->email, 'password' => 'wrong'])->assertSessionHasErrors('email');
        $this->assertGuest();
    }

    public function test_deactivated_session_is_revoked_on_next_request(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);
        $user->update(['is_active' => false]);
        $this->get('/pos')->assertRedirect(route('login'));
        $this->assertGuest();
    }

    public static function roles(): array
    {
        return ['owner' => ['owner', true, true], 'admin' => ['admin', true, true], 'cashier' => ['cashier', false, false]];
    }

    #[DataProvider('roles')]
    public function test_role_gate_matrix(string $role, bool $catalog, bool $discount): void
    {
        $user = User::factory()->create(['role' => $role, 'can_manage_catalog' => true, 'can_discount' => true]);
        $this->assertSame($catalog, Gate::forUser($user)->allows('manage-catalog'));
        $this->assertSame($discount, Gate::forUser($user)->allows('discount'));
        $this->assertSame($role === 'owner', Gate::forUser($user)->allows('manage-users'));
    }

    public function test_cashier_cannot_reach_owner_or_catalog_routes(): void
    {
        $this->actingAs(User::factory()->create());
        foreach (['/users', '/settings', '/reports', '/audit', '/products', '/categories'] as $path) {
            $this->get($path)->assertForbidden();
        }
        $this->post('/categories', ['name' => 'Forged', 'is_active' => true])->assertForbidden();
        $this->assertDatabaseMissing('categories', ['name' => 'Forged']);
    }

    public function test_admin_without_catalog_permission_is_forbidden(): void
    {
        $this->actingAs(User::factory()->admin()->create(['can_manage_catalog' => false]));
        $this->get('/products')->assertForbidden();
        $this->post('/products', [])->assertForbidden();
    }

    public function test_owner_pages_and_pos_render_with_database_data(): void
    {
        $owner = User::factory()->owner()->create();
        Product::factory()->create();
        $this->actingAs($owner);
        foreach (['/', '/pos', '/products', '/products/create', '/categories', '/categories/create', '/users', '/users/create', '/settings', '/reports', '/audit', '/transactions'] as $path) {
            $this->get($path)->assertOk();
        }
    }

    public function test_product_crud_archives_and_audits(): void
    {
        $this->actingAs(User::factory()->admin()->create());
        $category = Category::factory()->create();
        $data = ['category_id' => $category->id, 'name' => 'Latte', 'sku' => 'LAT-TEST', 'product_type' => 'drink', 'selling_price' => '26000', 'cost_price' => '9000', 'is_active' => true,
            'variants' => [['name' => 'Iced', 'price_adjustment' => '2000']]];
        $this->post('/products', $data)->assertRedirect(route('products.index'));
        $product = Product::where('sku', 'LAT-TEST')->firstOrFail();
        $this->assertDatabaseHas('product_variants', ['product_id' => $product->id, 'name' => 'Iced', 'is_active' => true]);
        $this->get('/products/'.$product->id.'/edit')->assertOk();
        $this->put('/products/'.$product->id, array_replace($data, ['name' => 'Latte baru', 'selling_price' => '28000']))->assertRedirect(route('products.index'));
        $this->assertDatabaseHas('products', ['id' => $product->id, 'name' => 'Latte baru', 'selling_price' => 28000]);
        $this->delete('/products/'.$product->id)->assertRedirect();
        $this->assertSoftDeleted($product);
        $this->assertDatabaseHas('audit_logs', ['action' => 'product.archived', 'auditable_id' => $product->id]);
    }

    public function test_duplicate_sku_and_negative_price_fail_validation(): void
    {
        $product = Product::factory()->create();
        $this->actingAs(User::factory()->owner()->create());
        $this->postJson('/products', [
            'name' => 'Invalid', 'sku' => $product->sku, 'category_id' => $product->category_id,
            'product_type' => 'drink', 'selling_price' => '-1', 'is_active' => true,
        ])->assertUnprocessable()->assertJsonValidationErrors(['sku', 'selling_price']);
        $this->assertDatabaseCount('products', 1);
    }

    public function test_category_crud_and_in_use_category_protection(): void
    {
        $this->actingAs(User::factory()->admin()->create());
        $this->post('/categories', ['name' => 'Manual Brew', 'is_active' => true])->assertRedirect(route('categories.index'));
        $category = Category::where('name', 'Manual Brew')->firstOrFail();
        $this->put('/categories/'.$category->id, ['name' => 'Pour Over', 'is_active' => true])->assertRedirect(route('categories.index'));
        $this->assertDatabaseHas('categories', ['id' => $category->id, 'name' => 'Pour Over']);
        $product = Product::factory()->for($category)->create();
        $this->delete('/categories/'.$category->id)->assertSessionHasErrors('category');
        $this->assertModelExists($category);
        $empty = Category::factory()->create();
        $this->delete('/categories/'.$empty->id)->assertRedirect();
        $this->assertModelMissing($empty);
    }

    public function test_server_recalculates_prices_tax_and_change(): void
    {
        $owner = User::factory()->owner()->create();
        $product = Product::factory()->create(['selling_price' => '24000.00']);
        Setting::create(['key' => 'tax_rate', 'value' => '11.00']);
        $payload = $this->payload($product, ['discount' => '3000', 'tax_rate' => '99', 'total' => '1']);
        $payload['items'][0]['price'] = '1';

        $this->actingAs($owner)->postJson('/pos/checkout', $payload)->assertOk()->assertJsonStructure(['redirect', 'invoice']);

        $sale = Sale::firstOrFail();
        $this->assertSame('48000.00', $sale->subtotal);
        $this->assertSame('3000.00', $sale->discount);
        $this->assertSame('4950.00', $sale->tax_amount);
        $this->assertSame('49950.00', $sale->total);
        $this->assertSame('50050.00', $sale->payment->change_amount);
        $this->assertDatabaseHas('sale_items', ['sale_id' => $sale->id, 'product_name' => $product->name, 'unit_price' => 24000, 'quantity' => 2, 'notes' => 'Tanpa gula']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'sale.checkout', 'auditable_id' => $sale->id]);
    }

    public function test_fractional_money_rounds_tax_to_nearest_cent(): void
    {
        $product = Product::factory()->create(['selling_price' => '0.05']);
        Setting::create(['key' => 'tax_rate', 'value' => '10.00']);
        $payload = $this->payload($product, ['items' => [['product_id' => $product->id, 'quantity' => 1]], 'amount_received' => '1.00']);
        $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $payload)->assertOk();
        $sale = Sale::firstOrFail();
        $this->assertSame('0.01', $sale->tax_amount);
        $this->assertSame('0.06', $sale->total);
        $this->assertSame('0.94', $sale->payment->change_amount);
    }

    public function test_variant_price_and_snapshot_are_preserved(): void
    {
        $product = Product::factory()->create(['selling_price' => '24000']);
        $variant = $product->variants()->create(['name' => 'Iced', 'sku' => 'ICE-TEST', 'price_adjustment' => '2000', 'is_active' => true]);
        $data = $this->payload($product, ['items' => [['product_id' => $product->id, 'variant_id' => $variant->id, 'quantity' => 1]]]);
        $owner = User::factory()->owner()->create();
        $this->actingAs($owner)->postJson('/pos/checkout', $data)->assertOk();
        $sale = Sale::firstOrFail();
        $product->update(['name' => 'Changed', 'selling_price' => '50000']);
        $product->delete();
        $this->assertSame('26000.00', $sale->items->first()->unit_price);
        $this->assertSame('Iced', $sale->items->first()->variant_name);
        $this->get('/transactions/'.$sale->id)->assertOk()->assertSee($sale->items->first()->product_name);
        $this->get('/transactions/'.$sale->id.'/print')->assertOk();
        $this->delete('/transactions/'.$sale->id)->assertMethodNotAllowed();
        $this->assertModelExists($sale);
    }

    public static function invalidCheckout(): array
    {
        return [
            'zero quantity' => ['quantity', 0, 'items.0.quantity'],
            'negative quantity' => ['quantity', -1, 'items.0.quantity'],
            'fractional quantity' => ['quantity', 1.5, 'items.0.quantity'],
            'over limit quantity' => ['quantity', 100, 'items.0.quantity'],
            'negative discount' => ['discount', '-1', 'discount'],
            'fractional cents' => ['discount', '0.001', 'discount'],
            'invalid payment' => ['payment_method', 'bitcoin', 'payment_method'],
            'invalid key' => ['idempotency_key', 'invalid', 'idempotency_key'],
        ];
    }

    #[DataProvider('invalidCheckout')]
    public function test_invalid_checkout_cannot_write_sale(string $field, mixed $value, string $error): void
    {
        $product = Product::factory()->create();
        $data = $this->payload($product);
        if ($field === 'quantity') {
            $data['items'][0]['quantity'] = $value;
        } else {
            $data[$field] = $value;
        }
        $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $data)->assertUnprocessable()->assertJsonValidationErrors($error);
        $this->assertDatabaseCount('sales', 0);
        $this->assertDatabaseCount('sale_items', 0);
        $this->assertDatabaseCount('payments', 0);
    }

    public function test_failed_payment_rolls_back_sale_items_and_audit(): void
    {
        $product = Product::factory()->create();
        $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $this->payload($product, ['amount_received' => '1']))->assertUnprocessable()->assertJsonValidationErrors('amount_received');
        $this->assertDatabaseCount('sales', 0);
        $this->assertDatabaseCount('sale_items', 0);
        $this->assertDatabaseCount('payments', 0);
        $this->assertDatabaseCount('audit_logs', 0);
    }

    public function test_discount_above_subtotal_and_unauthorized_discount_fail(): void
    {
        $product = Product::factory()->create();
        $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $this->payload($product, ['discount' => '1000']))->assertForbidden();
        $this->actingAs(User::factory()->owner()->create())->postJson('/pos/checkout', $this->payload($product, ['discount' => '50000']))->assertUnprocessable()->assertJsonValidationErrors('discount');
        $this->assertDatabaseCount('sales', 0);
    }

    public function test_inactive_product_and_wrong_variant_are_rejected(): void
    {
        $product = Product::factory()->create(['is_active' => false]);
        $user = User::factory()->create();
        $this->actingAs($user)->postJson('/pos/checkout', $this->payload($product))->assertUnprocessable()->assertJsonValidationErrors('items');
        $product->update(['is_active' => true]);
        $other = Product::factory()->create();
        $variant = $other->variants()->create(['name' => 'Other', 'sku' => 'OTHER-VAR', 'price_adjustment' => '1000', 'is_active' => true]);
        $this->postJson('/pos/checkout', $this->payload($product, ['items' => [['product_id' => $product->id, 'variant_id' => $variant->id, 'quantity' => 1]]]))->assertUnprocessable()->assertJsonValidationErrors('items');
        $this->assertDatabaseCount('sales', 0);
    }

    public function test_same_checkout_key_returns_same_invoice_and_rejects_changed_payload(): void
    {
        $product = Product::factory()->create();
        $this->actingAs(User::factory()->create());
        $data = $this->payload($product);
        $first = $this->postJson('/pos/checkout', $data)->assertOk()->json('invoice');
        $this->postJson('/pos/checkout', $data)->assertOk()->assertJsonPath('invoice', $first);
        $this->postJson('/pos/checkout', array_replace($data, ['customer_name' => 'Different']))->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
        $this->assertDatabaseCount('sales', 1);
        $this->assertDatabaseCount('payments', 1);
        $this->postJson('/pos/checkout', $this->payload($product))->assertOk();
        $this->assertDatabaseCount('sales', 2);
        $this->assertSame(2, Sale::distinct()->count('invoice_number'));
    }

    public function test_simulated_pending_payment_requires_explicit_confirmation(): void
    {
        $product = Product::factory()->create();
        $cashier = User::factory()->create();
        $this->actingAs($cashier)->postJson('/pos/checkout', $this->payload($product, ['payment_method' => 'qris', 'payment_confirmed' => false]))->assertOk();
        $sale = Sale::firstOrFail();
        $this->assertSame('pending', $sale->status);
        $this->assertNull($sale->payment->paid_at);
        $this->assertTrue($sale->payment->is_simulated);
        $this->post('/transactions/'.$sale->id.'/confirm', [])->assertSessionHasErrors('confirmed');
        $this->post('/transactions/'.$sale->id.'/confirm', ['confirmed' => '1'])->assertRedirect();
        $this->assertDatabaseHas('sales', ['id' => $sale->id, 'status' => 'paid']);
        $this->assertDatabaseHas('payments', ['sale_id' => $sale->id, 'status' => 'paid', 'amount_received' => 48000]);
        $this->post('/transactions/'.$sale->id.'/confirm', ['confirmed' => '1'])->assertRedirect();
        $this->assertDatabaseCount('payments', 1);
        $this->assertSame(1, AuditLog::where('action', 'payment.simulated_confirmation')->count());
    }

    public function test_disabled_payment_simulation_rolls_back(): void
    {
        config(['pos.simulate_payments' => false]);
        $product = Product::factory()->create();
        $this->actingAs(User::factory()->create())->postJson('/pos/checkout', $this->payload($product, ['payment_method' => 'transfer', 'payment_confirmed' => true]))->assertUnprocessable();
        $this->assertDatabaseCount('sales', 0);
    }

    public function test_history_and_receipts_are_scoped_to_cashier(): void
    {
        $cashier = User::factory()->create();
        $own = Sale::factory()->for($cashier, 'cashier')->create(['invoice_number' => 'OWN-INVOICE']);
        $other = Sale::factory()->create(['invoice_number' => 'OTHER-INVOICE', 'customer_name' => 'Meja X']);
        $this->actingAs($cashier)->get('/transactions?q=INVOICE&cashier='.$other->user_id)->assertOk()->assertSee('OWN-INVOICE')->assertDontSee('OTHER-INVOICE');
        $this->get('/transactions/'.$other->id)->assertForbidden();
        $this->get('/transactions/'.$other->id.'/print')->assertForbidden();
        $this->actingAs(User::factory()->admin()->create())->get('/transactions?q=OTHER')->assertOk()->assertSee('OTHER-INVOICE')->assertDontSee('OWN-INVOICE');
    }

    public function test_user_password_is_hashed_and_audit_excludes_secrets(): void
    {
        $owner = User::factory()->owner()->create();
        $this->actingAs($owner)->post('/users', ['name' => 'New cashier', 'email' => 'new@suwanting.test', 'password' => 'SafePassword!123', 'role' => 'cashier', 'is_active' => true])->assertRedirect(route('users.index'));
        $user = User::where('email', 'new@suwanting.test')->firstOrFail();
        $this->assertTrue(Hash::check('SafePassword!123', $user->password));
        $this->assertArrayNotHasKey('password', AuditLog::where('action', 'user.created')->firstOrFail()->new_values);
        $this->put('/users/'.$owner->id, ['name' => $owner->name, 'email' => $owner->email, 'role' => 'cashier', 'is_active' => false])->assertSessionHasErrors('role');
        $this->assertDatabaseHas('users', ['id' => $owner->id, 'role' => 'owner', 'is_active' => true]);
    }

    public function test_settings_are_owner_only_and_tax_change_is_audited(): void
    {
        $owner = User::factory()->owner()->create();
        $this->actingAs($owner)->put('/settings', ['shop_name' => 'Suwanting Coffee', 'shop_address' => 'Test', 'tax_rate' => '11.00'])->assertRedirect();
        $this->assertDatabaseHas('settings', ['key' => 'tax_rate', 'value' => '11.00']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'settings.updated']);
    }

    public function test_html_is_escaped_in_product_views(): void
    {
        $product = Product::factory()->create(['name' => '<script>alert(1)</script>']);
        $this->actingAs(User::factory()->owner()->create())->get('/products')->assertOk()->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;', false)->assertDontSee('<script>alert(1)</script>', false);
    }

    public function test_numeric_json_amounts_preserve_fractional_cents(): void
    {
        $product = Product::factory()->create(['selling_price' => '1.25']);
        $data = $this->payload($product, ['discount' => 0.25, 'amount_received' => 2.75]);

        $this->actingAs(User::factory()->owner()->create())->postJson('/pos/checkout', $data)->assertOk();

        $sale = Sale::firstOrFail();
        $this->assertSame('2.25', $sale->total);
        $this->assertSame('0.25', $sale->discount);
        $this->assertSame('2.75', $sale->payment->amount_received);
        $this->assertSame('0.50', $sale->payment->change_amount);
    }

    public function test_report_and_dashboard_preserve_fractional_totals(): void
    {
        $owner = User::factory()->owner()->create();
        Sale::factory()->for($owner, 'cashier')->create(['subtotal' => '0.05', 'total' => '0.05']);

        $this->actingAs($owner)->get('/reports')->assertOk()->assertSee('Rp 0,05');
        $this->get('/')->assertOk()->assertSee('Rp 0,05');
    }

    public function test_history_combines_cashier_date_method_status_and_search_filters(): void
    {
        $this->travelTo(now()->setDate(2026, 10, 19)->setTime(10, 0));
        $cashier = User::factory()->create();
        $other = User::factory()->create();
        foreach ([
            ['TARGET-MATCH', $cashier, 'pending', 'qris', now()],
            ['TARGET-PAID', $cashier, 'paid', 'qris', now()],
            ['TARGET-CASH', $cashier, 'pending', 'cash', now()],
            ['TARGET-OTHER', $other, 'pending', 'qris', now()],
            ['TARGET-OLD', $cashier, 'pending', 'qris', now()->subDay()],
        ] as [$invoice, $user, $status, $method, $date]) {
            $sale = Sale::factory()->for($user, 'cashier')->create(['invoice_number' => $invoice, 'status' => $status, 'created_at' => $date]);
            $sale->payment()->create(['method' => $method, 'amount_received' => '0', 'amount_due' => $sale->total, 'change_amount' => '0', 'status' => $status, 'is_simulated' => true]);
        }

        $this->actingAs(User::factory()->owner()->create())
            ->get('/transactions?cashier='.$cashier->id.'&q=TARGET&method=qris&status=pending&from=2026-10-19&to=2026-10-19')
            ->assertOk()->assertSee('TARGET-MATCH')->assertDontSee('TARGET-PAID')->assertDontSee('TARGET-CASH')->assertDontSee('TARGET-OTHER')->assertDontSee('TARGET-OLD');
    }

    public function test_history_accepts_end_date_alone_and_rejects_reversed_range(): void
    {
        $this->actingAs(User::factory()->owner()->create());
        $this->get('/transactions?to=2026-10-19')->assertOk();
        $this->getJson('/transactions?from=2026-10-20&to=2026-10-19')->assertUnprocessable()->assertJsonValidationErrors('to');
    }

    public function test_uploaded_photo_is_private_validated_and_readable_by_cashier(): void
    {
        Storage::fake('local');
        $category = Category::factory()->create();
        $photo = UploadedFile::fake()->createWithContent('menu.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='));
        $data = ['category_id' => $category->id, 'name' => 'Foto menu', 'sku' => 'PHOTO-MENU', 'product_type' => 'drink', 'selling_price' => '24000', 'is_active' => true, 'photo' => $photo];

        $this->actingAs(User::factory()->owner()->create())->post('/products', $data)->assertRedirect(route('products.index'))->assertSessionHasNoErrors();
        $product = Product::where('sku', 'PHOTO-MENU')->firstOrFail();
        Storage::disk('local')->assertExists($product->photo_path);
        $this->actingAs(User::factory()->create())->get('/products/'.$product->id.'/photo')->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->postJson('/products', $data)->assertForbidden();
        $this->assertDatabaseCount('products', 1);
    }

    public function test_cashier_pos_does_not_expose_cost_prices(): void
    {
        Product::factory()->create(['cost_price' => '987654.32']);

        $this->actingAs(User::factory()->create())->get('/pos')->assertOk()
            ->assertDontSee('cost_price', false)->assertDontSee('987654.32', false);
    }

    public function test_login_rate_limits_repeated_failed_attempts(): void
    {
        $user = User::factory()->create();
        foreach (range(1, 5) as $attempt) {
            $this->post('/login', ['email' => $user->email, 'password' => 'incorrect'])->assertSessionHasErrors('email');
        }

        $this->post('/login', ['email' => $user->email, 'password' => 'incorrect'])->assertTooManyRequests();
        $this->assertGuest();
    }

    public function test_demo_seeder_is_idempotent_and_preserves_modified_data(): void
    {
        $this->seed();
        $user = User::where('email', 'owner@suwanting.test')->firstOrFail();
        $user->update(['name' => 'Real owner', 'password' => 'CustomPass!123']);
        $product = Product::where('sku', 'ESP-001')->firstOrFail();
        $product->update(['selling_price' => '12345']);
        $this->seed();
        $this->assertSame('Real owner', $user->fresh()->name);
        $this->assertTrue(Hash::check('CustomPass!123', $user->fresh()->password));
        $this->assertSame('12345.00', $product->fresh()->selling_price);
        $this->assertDatabaseCount('users', 3);
        $this->assertDatabaseCount('sales', 8);
    }
}
