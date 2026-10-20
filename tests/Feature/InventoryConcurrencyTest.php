<?php

namespace Tests\Feature;

use App\Models\Ingredient;
use App\Models\Product;
use App\Models\Recipe;
use App\Models\Sale;
use App\Models\User;
use App\Services\InventoryService;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class InventoryConcurrencyTest extends TestCase
{
    use DatabaseMigrations;

    protected function beforeRefreshingDatabase(): void
    {
        if (config('database.default') !== 'mysql' || getenv('POS_MYSQL_CONCURRENCY') !== '1') {
            $this->markTestSkipped('Aktifkan POS_MYSQL_CONCURRENCY=1 pada database MySQL testing terpisah.');
        }
        if (! app()->environment('testing') || ! str_ends_with(config('database.connections.mysql.database'), '_test')) {
            $this->fail('Test konkurensi hanya boleh mereset database testing berakhiran _test.');
        }
    }

    private function stock(User $owner): Ingredient
    {
        $ingredient = Ingredient::factory()->create();
        app(InventoryService::class)->adjust($owner, $ingredient, [
            'idempotency_key' => (string) Str::uuid(), 'type' => 'receipt', 'quantity' => '10',
            'reference' => 'CONCURRENCY-OPEN', 'reason' => 'Stok pengujian konkurensi',
        ]);

        return $ingredient;
    }

    private function recipe(Ingredient $ingredient): Product
    {
        $product = Product::factory()->create();
        $recipe = Recipe::factory()->create(['product_id' => $product->id]);
        $recipe->items()->create(['ingredient_id' => $ingredient->id, 'quantity' => '8']);

        return $product;
    }

    private function payload(Product $product): array
    {
        return ['idempotency_key' => (string) Str::uuid(), 'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_received' => '100000', 'discount' => '0'];
    }

    private function runTogether(Ingredient $ingredient, array $jobs): array
    {
        $code = <<<'PHP'
require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
file_put_contents(getenv('INVENTORY_READY'), 'ready');
try {
    $sale = app(App\Services\CheckoutService::class)->checkout(
        App\Models\User::findOrFail((int) getenv('INVENTORY_ACTOR')),
        json_decode(getenv('INVENTORY_PAYLOAD'), true, 512, JSON_THROW_ON_ERROR)
    );
    echo json_encode(['status' => 'paid', 'id' => $sale->id], JSON_THROW_ON_ERROR);
} catch (Illuminate\Validation\ValidationException $exception) {
    echo json_encode(['status' => 'rejected', 'errors' => $exception->errors()], JSON_THROW_ON_ERROR);
}
PHP;
        $connection = config('database.connections.mysql');
        $processes = [];
        $markers = [];
        DB::beginTransaction();
        try {
            Ingredient::whereKey($ingredient->id)->lockForUpdate()->firstOrFail();
            foreach ($jobs as [$actor, $payload]) {
                $marker = tempnam(sys_get_temp_dir(), 'pos-inventory-');
                $markers[] = $marker;
                $process = new Process([PHP_BINARY, '-r', $code], base_path(), [
                    'APP_ENV' => 'testing', 'DB_CONNECTION' => 'mysql', 'DB_URL' => '',
                    'DB_HOST' => $connection['host'], 'DB_PORT' => (string) $connection['port'],
                    'DB_DATABASE' => $connection['database'], 'DB_USERNAME' => $connection['username'],
                    'DB_PASSWORD' => $connection['password'], 'SESSION_DRIVER' => 'array', 'CACHE_STORE' => 'array',
                    'INVENTORY_READY' => $marker, 'INVENTORY_ACTOR' => (string) $actor->id,
                    'INVENTORY_PAYLOAD' => json_encode($payload, JSON_THROW_ON_ERROR),
                ]);
                $process->setTimeout(25)->start();
                $processes[] = $process;
            }
            $deadline = microtime(true) + 15;
            while (collect($markers)->contains(fn (string $marker): bool => file_get_contents($marker) !== 'ready')) {
                if (microtime(true) >= $deadline) {
                    $this->fail('Proses checkout tidak siap: '.implode(' ', array_map(fn (Process $process): string => $process->getErrorOutput(), $processes)));
                }
                usleep(20000);
            }
            usleep(200000);
            DB::commit();
            $results = [];
            foreach ($processes as $process) {
                $exitCode = $process->wait();
                $this->assertSame(0, $exitCode, $process->getErrorOutput());
                $results[] = json_decode($process->getOutput(), true, 512, JSON_THROW_ON_ERROR);
            }

            return $results;
        } finally {
            if (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
            foreach ($processes as $process) {
                if ($process->isRunning()) {
                    $process->stop();
                }
            }
            foreach ($markers as $marker) {
                unlink($marker);
            }
        }
    }

    public function test_concurrent_cashiers_cannot_spend_same_ingredient_twice(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = $this->stock($owner);
        $first = $this->recipe($ingredient);
        $second = $this->recipe($ingredient);
        $cashiers = User::factory()->count(2)->create();

        $results = $this->runTogether($ingredient, [
            [$cashiers[0], $this->payload($first)], [$cashiers[1], $this->payload($second)],
        ]);

        $this->assertSame(1, collect($results)->where('status', 'paid')->count());
        $this->assertSame(1, collect($results)->where('status', 'rejected')->count());
        $this->assertSame('2.000', $ingredient->fresh()->stock_quantity);
        $this->assertDatabaseCount('sales', 1);
        $this->assertDatabaseCount('payments', 1);
        $this->assertDatabaseCount('sale_item_ingredients', 1);
        $this->assertDatabaseCount('stock_movements', 2);
    }

    public function test_concurrent_identical_checkout_returns_one_sale_and_one_consumption(): void
    {
        $owner = User::factory()->owner()->create();
        $ingredient = $this->stock($owner);
        $product = $this->recipe($ingredient);
        $cashier = User::factory()->create();
        $payload = $this->payload($product);

        $results = $this->runTogether($ingredient, [[$cashier, $payload], [$cashier, $payload]]);

        $this->assertSame(['paid', 'paid'], array_column($results, 'status'));
        $this->assertSame($results[0]['id'], $results[1]['id']);
        $this->assertSame('2.000', $ingredient->fresh()->stock_quantity);
        $this->assertDatabaseCount('sales', 1);
        $this->assertDatabaseCount('stock_movements', 2);
        $this->assertSame('paid', Sale::firstOrFail()->status);
    }
}
