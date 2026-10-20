<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Setting;
use App\Models\User;
use Database\Seeders\CustomerSeeder;
use Illuminate\Foundation\Testing\LazilyRefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class CustomerAndSettingsTest extends TestCase
{
    use LazilyRefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
    }

    private function checkoutPayload(Product $product, array $overrides = []): array
    {
        return array_replace([
            'idempotency_key' => (string) Str::uuid(),
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_received' => '100000', 'discount' => '0',
        ], $overrides);
    }

    private function settingsPayload(array $overrides = []): array
    {
        return array_replace(Setting::DEFAULTS, $overrides);
    }

    public function test_guests_cannot_access_customer_or_settings_endpoints(): void
    {
        $this->get('/customers')->assertRedirect(route('login'));
        $this->getJson('/customers/lookup')->assertUnauthorized();
        $this->postJson('/customers', ['name' => 'Unauthorized'])->assertUnauthorized();
        $this->postJson('/settings/receipt-preview', [])->assertUnauthorized();
        $this->postJson('/settings/connection-check')->assertUnauthorized();
        $this->assertDatabaseCount('customers', 0);
    }

    public function test_admin_can_create_edit_filter_and_archive_customers_with_audit(): void
    {
        $this->actingAs(User::factory()->admin()->create());
        $this->get('/customers/create')->assertOk();
        $this->post('/customers', ['name' => 'Dewi', 'phone' => '081234567890', 'email' => 'dewi@example.test', 'address' => 'Suwanting', 'notes' => 'Tanpa gula', 'is_active' => true])
            ->assertRedirect(route('customers.index'))->assertSessionHasNoErrors();
        $customer = Customer::where('name', 'Dewi')->firstOrFail();
        $this->get('/customers/'.$customer->id.'/edit')->assertOk()->assertSee('Tanpa gula');
        $this->put('/customers/'.$customer->id, ['name' => 'Dewi Baru', 'phone' => '081234567891', 'is_active' => false])->assertRedirect(route('customers.index'));
        $this->assertDatabaseHas('customers', ['id' => $customer->id, 'name' => 'Dewi Baru', 'is_active' => false]);
        $this->get('/customers?q=Dewi&status=inactive')->assertOk()->assertSee('Dewi Baru');
        $this->get('/customers?status=active')->assertOk()->assertDontSee('Dewi Baru');
        $this->delete('/customers/'.$customer->id)->assertRedirect(route('customers.index'));
        $this->assertSoftDeleted($customer);
        $this->assertDatabaseHas('audit_logs', ['action' => 'customer.saved', 'auditable_id' => $customer->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'customer.archived', 'auditable_id' => $customer->id]);
        $this->get('/customers/'.$customer->id.'/edit')->assertNotFound();
    }

    public function test_cashier_can_find_active_customers_but_cannot_manage_them_or_settings(): void
    {
        $active = Customer::factory()->create(['name' => 'Aktif Tampil', 'notes' => 'PRIVATE-NOTE', 'email' => 'private@example.test']);
        Customer::factory()->create(['name' => 'Nonaktif Rahasia', 'is_active' => false]);
        $this->actingAs(User::factory()->create());
        $this->get('/customers?status=inactive')->assertOk()->assertSee('Aktif Tampil')->assertDontSee('Nonaktif Rahasia')->assertDontSee('PRIVATE-NOTE')->assertDontSee('private@example.test');
        $this->get('/customers/create')->assertForbidden();
        $this->get('/customers/'.$active->id.'/edit')->assertForbidden();
        $this->postJson('/customers', ['name' => 'Changed'])->assertForbidden();
        $this->putJson('/customers/'.$active->id, ['name' => 'Changed'])->assertForbidden();
        $this->deleteJson('/customers/'.$active->id)->assertForbidden();
        $this->get('/settings')->assertForbidden();
        $this->putJson('/settings', $this->settingsPayload())->assertForbidden();
        $this->postJson('/settings/receipt-preview', $this->settingsPayload())->assertForbidden();
        $this->postJson('/settings/connection-check')->assertForbidden();
        $this->assertDatabaseHas('customers', ['id' => $active->id, 'name' => 'Aktif Tampil', 'deleted_at' => null]);
        $this->assertDatabaseCount('audit_logs', 0);
    }

    public static function invalidCustomer(): array
    {
        return [
            'missing name' => ['name', ''], 'long name' => ['name', str_repeat('n', 121)],
            'bad phone' => ['phone', '<script>1</script>'], 'long phone' => ['phone', str_repeat('1', 31)],
            'bad email' => ['email', 'invalid'], 'long address' => ['address', str_repeat('a', 256)],
            'long notes' => ['notes', str_repeat('n', 1001)], 'bad status' => ['is_active', 'maybe'],
        ];
    }

    #[DataProvider('invalidCustomer')]
    public function test_invalid_customer_returns_422_without_writes(string $field, mixed $value): void
    {
        $this->actingAs(User::factory()->owner()->create())->postJson('/customers', array_replace(['name' => 'Customer', 'is_active' => true], [$field => $value]))
            ->assertUnprocessable()->assertJsonValidationErrors($field);
        $this->assertDatabaseCount('customers', 0);
        $this->assertDatabaseCount('audit_logs', 0);
    }

    public function test_customer_lookup_filters_names_and_phones_and_only_exposes_minimal_active_data(): void
    {
        $customer = Customer::factory()->create(['name' => 'Dewi Kopi', 'phone' => '0812990011', 'notes' => 'PRIVATE']);
        Customer::factory()->create(['name' => 'Dewi Nonaktif', 'phone' => '0812990022', 'is_active' => false]);
        $archived = Customer::factory()->create(['name' => 'Dewi Arsip', 'phone' => '0812990033']);
        $archived->delete();
        $this->actingAs(User::factory()->create());
        foreach (['Dewi', '08129900'] as $term) {
            $this->getJson('/customers/lookup?q='.$term)->assertOk()->assertExactJson([
                'customers' => [['id' => $customer->id, 'name' => 'Dewi Kopi', 'phone' => '0812990011']],
            ]);
        }
        $this->getJson('/customers/lookup?q='.urlencode("' OR 1=1 --"))->assertOk()->assertExactJson(['customers' => []]);
        Customer::factory()->count(22)->create();
        $this->getJson('/customers/lookup')->assertOk()->assertJsonCount(20, 'customers');
        $this->getJson('/customers/lookup?q='.str_repeat('q', 121))->assertUnprocessable()->assertJsonValidationErrors('q');
    }

    public function test_customer_name_is_escaped_on_pages_and_forms(): void
    {
        $customer = Customer::factory()->create(['name' => '<script>alert(1)</script>']);
        $this->actingAs(User::factory()->owner()->create());
        foreach (['/customers', '/customers/'.$customer->id.'/edit'] as $url) {
            $this->get($url)->assertOk()->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;', false)->assertDontSee('<script>alert(1)</script>', false);
        }
    }

    public function test_checkout_accepts_no_customer_and_free_text_customer(): void
    {
        $product = Product::factory()->create();
        $this->actingAs(User::factory()->create());
        $this->postJson('/pos/checkout', $this->checkoutPayload($product))->assertOk();
        $this->assertDatabaseHas('sales', ['customer_id' => null, 'customer_name' => null]);
        $this->postJson('/pos/checkout', $this->checkoutPayload($product, ['customer_name' => 'Meja 03']))->assertOk();
        $this->assertDatabaseHas('sales', ['customer_id' => null, 'customer_name' => 'Meja 03']);
        $this->assertDatabaseCount('sales', 2);
    }

    public function test_registered_customer_name_is_canonical_and_history_and_retry_survive_archive(): void
    {
        $customer = Customer::factory()->create(['name' => 'Dewi Awal']);
        $product = Product::factory()->create();
        $owner = User::factory()->owner()->create();
        $payload = $this->checkoutPayload($product, ['customer_id' => $customer->id, 'customer_name' => 'Nama palsu']);
        $this->actingAs($owner)->postJson('/pos/checkout', $payload)->assertOk();
        $sale = Sale::firstOrFail();
        $this->assertSame($customer->id, $sale->customer_id);
        $this->assertSame('Dewi Awal', $sale->customer_name);
        $this->put('/customers/'.$customer->id, ['name' => 'Dewi Baru', 'is_active' => false])->assertRedirect();
        $this->delete('/customers/'.$customer->id)->assertRedirect();
        $this->get('/transactions/'.$sale->id)->assertOk()->assertSee('Dewi Awal')->assertDontSee('Dewi Baru');
        $this->get('/transactions/'.$sale->id.'/print')->assertOk()->assertSee('Dewi Awal');
        $this->postJson('/pos/checkout', $payload)->assertOk()->assertJsonPath('invoice', $sale->invoice_number);
        $this->assertDatabaseCount('sales', 1);
        $this->assertDatabaseCount('payments', 1);
        $this->assertSame('Dewi Baru', $sale->fresh()->customer->name);
        $this->assertSame(1, AuditLog::where('action', 'sale.checkout')->count());
        $this->postJson('/pos/checkout', array_replace($payload, ['customer_id' => null]))->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
    }

    public function test_missing_inactive_or_archived_customer_rejects_new_checkout_without_writes(): void
    {
        $inactive = Customer::factory()->create(['is_active' => false]);
        $archived = Customer::factory()->create();
        $archived->delete();
        $product = Product::factory()->create();
        $this->actingAs(User::factory()->create());
        foreach ([$inactive->id, $archived->id, 999999] as $id) {
            $this->postJson('/pos/checkout', $this->checkoutPayload($product, ['customer_id' => $id]))
                ->assertUnprocessable()->assertJsonValidationErrors('customer_id');
        }
        $this->assertDatabaseCount('sales', 0);
        $this->assertDatabaseCount('payments', 0);
        $this->assertDatabaseCount('audit_logs', 0);
    }

    public function test_tax_toggle_applies_on_server_and_pos_and_preserves_historical_tax(): void
    {
        $owner = User::factory()->owner()->create();
        $product = Product::factory()->create(['selling_price' => '24000.00']);
        $this->actingAs($owner)->put('/settings', $this->settingsPayload(['tax_enabled' => true, 'tax_rate' => '11.00']))->assertRedirect()->assertSessionHasNoErrors();
        $this->get('/pos')->assertOk()->assertViewHas('taxRate', '11.00');
        $this->postJson('/pos/checkout', $this->checkoutPayload($product, ['discount' => '4000']))->assertOk();
        $taxed = Sale::firstOrFail();
        $this->assertSame('2200.00', $taxed->tax_amount);
        $this->assertSame('22200.00', $taxed->total);
        $this->putJson('/settings', $this->settingsPayload(['tax_enabled' => false, 'tax_rate' => '11.00']))->assertRedirect();
        $this->assertDatabaseHas('settings', ['key' => 'tax_enabled', 'value' => '0']);
        $this->assertDatabaseHas('settings', ['key' => 'tax_rate', 'value' => '11.00']);
        $this->get('/pos')->assertOk()->assertViewHas('taxRate', '0.00')->assertSee('Pajak nonaktif');
        $this->postJson('/pos/checkout', $this->checkoutPayload($product, ['tax_rate' => '99', 'tax_enabled' => true]))->assertOk();
        $untaxed = Sale::latest('id')->firstOrFail();
        $this->assertSame('0.00', $untaxed->tax_rate);
        $this->assertSame('0.00', $untaxed->tax_amount);
        $this->assertSame('24000.00', $untaxed->total);
        $this->get('/transactions/'.$taxed->id.'/print')->assertOk()->assertSee('Pajak 11.00%')->assertSee('Rp 2.200');
        $this->assertSame('22200.00', $taxed->fresh()->total);
        $this->put('/settings', $this->settingsPayload(['tax_enabled' => '1', 'tax_rate' => '11.00']))->assertRedirect();
        $this->get('/pos')->assertOk()->assertViewHas('taxRate', '11.00');
    }

    public function test_settings_save_receipt_options_contacts_and_audit_but_ignore_unknown_keys(): void
    {
        $this->actingAs(User::factory()->owner()->create())->put('/settings', $this->settingsPayload([
            'shop_phone' => '08123456789', 'shop_email' => 'toko@example.test', 'receipt_paper' => '58',
            'receipt_header' => 'Selamat datang', 'receipt_footer' => "Terima kasih\nSampai jumpa", 'receipt_auto_print' => '0',
            'receipt_show_customer' => '0', 'receipt_show_sku' => '1', 'unknown_key' => 'ignore',
        ]))->assertRedirect()->assertSessionHasNoErrors();
        $this->assertDatabaseHas('settings', ['key' => 'receipt_paper', 'value' => '58']);
        $this->assertDatabaseHas('settings', ['key' => 'receipt_footer', 'value' => "Terima kasih\nSampai jumpa"]);
        $this->assertDatabaseHas('settings', ['key' => 'shop_email', 'value' => 'toko@example.test']);
        $this->assertDatabaseMissing('settings', ['key' => 'unknown_key']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'settings.updated']);
        $this->get('/settings')->assertOk()->assertSee('Selamat datang')->assertSee('58 mm')->assertSee('Cek koneksi sekarang');
    }

    public static function invalidSettings(): array
    {
        return [
            'tax over 100' => ['tax_rate', '101'], 'negative tax' => ['tax_rate', '-1'],
            'fractional tax' => ['tax_rate', '11.001'], 'bad toggle' => ['tax_enabled', 'yes'],
            'bad paper' => ['receipt_paper', '123'], 'long header' => ['receipt_header', str_repeat('h', 501)],
            'long footer' => ['receipt_footer', str_repeat('f', 501)], 'bad email' => ['shop_email', 'invalid'],
            'bad receipt toggle' => ['receipt_show_sku', 'sometimes'],
        ];
    }

    #[DataProvider('invalidSettings')]
    public function test_invalid_settings_return_422_without_partial_writes(string $field, mixed $value): void
    {
        $this->actingAs(User::factory()->owner()->create())->putJson('/settings', $this->settingsPayload([$field => $value]))
            ->assertUnprocessable()->assertJsonValidationErrors($field);
        $this->assertDatabaseCount('settings', 0);
        $this->assertDatabaseCount('audit_logs', 0);
    }

    public function test_receipt_preview_uses_unsaved_values_with_escaping_and_never_writes_or_auto_prints(): void
    {
        $this->actingAs(User::factory()->owner()->create())->post('/settings/receipt-preview', $this->settingsPayload([
            'shop_name' => '<script>alert(1)</script>', 'shop_phone' => '0812345678', 'shop_email' => 'toko@example.test',
            'receipt_header' => '<b>Header</b>', 'receipt_footer' => "Baris pertama\nBaris kedua",
            'receipt_paper' => '58', 'receipt_show_cashier' => '0', 'receipt_show_customer' => '0',
            'receipt_show_sku' => '1', 'tax_enabled' => '0', 'tax_rate' => '11.00',
        ]))->assertOk()->assertSee('Pratinjau struk')->assertSee('50mm', false)
            ->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;', false)->assertDontSee('<script>alert(1)</script>', false)
            ->assertSee('&lt;b&gt;Header&lt;/b&gt;', false)->assertSee("Baris pertama\nBaris kedua")
            ->assertSee('toko@example.test')->assertSee('KSS-001-ICED')
            ->assertDontSee('Kasir:')->assertDontSee('Pelanggan Contoh')->assertSee('Pajak 0.00%')
            ->assertDontSee("window.addEventListener('load'", false);
        $this->assertDatabaseCount('settings', 0);
        $this->assertDatabaseCount('sales', 0);
        $this->assertDatabaseCount('audit_logs', 0);
    }

    public function test_saved_receipt_options_apply_to_real_pending_sale_without_changing_payment_state(): void
    {
        $product = Product::factory()->create(['sku' => 'RECEIPT-SKU']);
        $owner = User::factory()->owner()->create();
        $this->actingAs($owner)->put('/settings', $this->settingsPayload([
            'receipt_footer' => '<script>bad()</script>', 'receipt_header' => 'Header Toko',
            'receipt_paper' => '58', 'receipt_show_cashier' => '0', 'receipt_show_customer' => '0', 'receipt_show_sku' => '1', 'receipt_auto_print' => '0',
        ]))->assertRedirect();
        $this->postJson('/pos/checkout', $this->checkoutPayload($product, ['customer_name' => 'CUSTOMER-HIDDEN', 'payment_method' => 'qris', 'payment_confirmed' => false]))->assertOk();
        $sale = Sale::firstOrFail();
        $this->get('/transactions/'.$sale->id.'/print')->assertOk()->assertSee('Header Toko')->assertSee('RECEIPT-SKU')->assertSee('50mm', false)
            ->assertSee('MENUNGGU PEMBAYARAN')->assertSee('&lt;script&gt;bad()&lt;/script&gt;', false)
            ->assertDontSee('<script>bad()</script>', false)->assertDontSee('CUSTOMER-HIDDEN')->assertDontSee('Kasir:')
            ->assertDontSee("window.addEventListener('load'", false);
        $this->assertSame('pending', $sale->fresh()->status);
    }

    public function test_connection_check_reports_fixed_endpoint_success_and_latency(): void
    {
        Http::preventStrayRequests();
        Http::fake(['https://www.gstatic.com/generate_204' => Http::response('', 204)]);
        $this->actingAs(User::factory()->owner()->create())->postJson('/settings/connection-check', ['url' => 'http://127.0.0.1/private'])
            ->assertOk()->assertJsonPath('online', true)->assertJsonStructure(['latency_ms', 'checked_at']);
        Http::assertSentCount(1);
        Http::assertSent(fn (ClientRequest $request): bool => $request->url() === 'https://www.gstatic.com/generate_204');
    }

    public function test_connection_check_handles_network_failure(): void
    {
        Http::preventStrayRequests();
        Http::fake(['https://www.gstatic.com/generate_204' => Http::failedConnection()]);
        $this->actingAs(User::factory()->owner()->create())->postJson('/settings/connection-check')
            ->assertOk()->assertJsonPath('online', false)->assertJsonPath('latency_ms', null);
        Http::assertSentCount(1);
    }

    public function test_connection_check_does_not_accept_captive_portal_or_service_error_as_online(): void
    {
        Http::preventStrayRequests();
        Http::fake(['https://www.gstatic.com/generate_204' => Http::sequence()->push('<html>Login WiFi</html>', 200)->push('', 302, ['Location' => 'http://example.test/login'])->push('', 503)]);
        $this->actingAs(User::factory()->owner()->create());
        foreach (range(1, 3) as $attempt) {
            $this->postJson('/settings/connection-check')->assertOk()->assertJsonPath('online', false)->assertJsonPath('latency_ms', null);
        }
        Http::assertSentCount(3);
    }

    public function test_customer_demo_seeder_preserves_edits_and_archived_records(): void
    {
        $this->seed(CustomerSeeder::class);
        $customer = Customer::firstOrFail();
        $customer->update(['name' => 'Edited Customer']);
        $customer->delete();
        $this->seed(CustomerSeeder::class);
        $this->assertDatabaseCount('customers', 1);
        $this->assertDatabaseHas('customers', ['id' => $customer->id, 'name' => 'Edited Customer']);
        $this->assertSoftDeleted($customer);
    }
}
