<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class CheckoutService
{
    public function __construct(private PaymentService $payments, private AuditService $audit, private InventoryService $inventory) {}

    public function checkout(User $cashier, array $data): Sale
    {
        $hash = hash('sha256', json_encode($data, JSON_THROW_ON_ERROR));

        return DB::transaction(function () use ($cashier, $data, $hash): Sale {
            $lockedUser = User::whereKey($cashier->id)->lockForUpdate()->firstOrFail();
            abort_unless($lockedUser->canOperate(), 403);
            $existing = Sale::where('idempotency_key', $data['idempotency_key'])->first();
            if ($existing) {
                abort_unless($existing->user_id === $cashier->id, 403);
                if ($existing->request_hash !== $hash) {
                    throw ValidationException::withMessages(['idempotency_key' => 'Kunci checkout sudah dipakai untuk pesanan lain. Muat ulang kasir.']);
                }

                return $existing;
            }

            $customer = null;
            if (! empty($data['customer_id'])) {
                $customer = Customer::whereKey($data['customer_id'])->where('is_active', true)->lockForUpdate()->first();
                if (! $customer) {
                    throw ValidationException::withMessages(['customer_id' => 'Pelanggan tidak ditemukan atau sudah nonaktif. Pilih pelanggan lain atau gunakan pelanggan umum.']);
                }
            }

            $products = Product::with(['category', 'variants'])
                ->whereIn('id', array_column($data['items'], 'product_id'))
                ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $subtotal = 0;
            $lines = [];
            foreach ($data['items'] as $line) {
                $product = $products->get($line['product_id']);
                if (! $product || ! $product->is_active || ! $product->category->is_active) {
                    throw ValidationException::withMessages(['items' => 'Produk sudah tidak tersedia. Segarkan katalog sebelum checkout.']);
                }
                $variant = empty($line['variant_id']) ? null : $product->variants->firstWhere('id', (int) $line['variant_id']);
                if (! empty($line['variant_id']) && (! $variant || ! $variant->is_active)) {
                    throw ValidationException::withMessages(['items' => 'Varian tidak sesuai produk atau sudah nonaktif.']);
                }
                $unitPrice = Money::cents($product->selling_price) + Money::cents($variant?->price_adjustment);
                $lineTotal = $unitPrice * $line['quantity'];
                $subtotal += $lineTotal;
                if ($subtotal > 90000000000) {
                    throw ValidationException::withMessages(['items' => 'Total pesanan melewati batas transaksi.']);
                }
                $lines[] = [
                    'product_id' => $product->id, 'product_variant_id' => $variant?->id,
                    'product_name' => $product->name, 'variant_name' => $variant?->name,
                    'sku' => $variant?->sku ?? $product->sku, 'unit_price' => Money::decimal($unitPrice),
                    'quantity' => $line['quantity'], 'discount' => '0.00',
                    'subtotal' => Money::decimal($lineTotal), 'notes' => $line['notes'] ?? null,
                ];
            }

            $discount = Money::cents($data['discount'] ?? '0', 'discount');
            if ($discount > 0) {
                Gate::forUser($lockedUser)->authorize('discount');
            }
            if ($discount > $subtotal) {
                throw ValidationException::withMessages(['discount' => 'Diskon tidak boleh melebihi subtotal.']);
            }
            $rate = Setting::effectiveTaxRate();
            $basisPoints = Money::cents($rate, 'tax_rate');
            $tax = intdiv(($subtotal - $discount) * $basisPoints + 5000, 10000);
            $total = $subtotal - $discount + $tax;
            if ($total > 99999999999) {
                throw ValidationException::withMessages(['items' => 'Total pesanan termasuk pajak melewati batas transaksi.']);
            }

            $sale = Sale::create([
                'user_id' => $lockedUser->id,
                'invoice_number' => 'SW-'.now()->format('ymd').'-'.Str::upper((string) Str::ulid()),
                'customer_id' => $customer?->id,
                'customer_name' => $customer?->name ?? ($data['customer_name'] ?? null),
                'status' => 'pending', 'subtotal' => Money::decimal($subtotal),
                'discount' => Money::decimal($discount), 'tax_rate' => Money::decimal($basisPoints),
                'tax_amount' => Money::decimal($tax), 'total' => Money::decimal($total),
                'idempotency_key' => $data['idempotency_key'], 'request_hash' => $hash,
                'is_demo' => config('pos.demo_mode'), 'notes' => $data['notes'] ?? null,
            ]);
            $sale->items()->createMany($lines);
            $this->inventory->snapshot($sale);
            $this->payments->create($sale, $data);
            $this->inventory->consume($sale, $lockedUser);
            $this->audit->record($lockedUser, 'sale.checkout', $sale, [], [
                'invoice_number' => $sale->invoice_number, 'total' => $sale->total, 'status' => $sale->status,
            ]);

            return $sale;
        }, 3);
    }
}
