<?php

namespace App\Services;

use App\Models\Ingredient;
use App\Models\Recipe;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class InventoryService
{
    public function __construct(private AuditService $audit) {}

    public function snapshot(Sale $sale): void
    {
        $items = $sale->items()->get();
        $recipes = Recipe::with(['items' => fn ($query) => $query->lockForUpdate(), 'items.ingredient.unit'])->whereIn('product_id', $items->pluck('product_id'))
            ->where('is_active', true)->orderBy('id')->lockForUpdate()->get()
            ->keyBy(fn (Recipe $recipe): string => $recipe->product_id.':'.$recipe->variant_key);

        foreach ($items as $item) {
            $recipe = $recipes->get($item->product_id.':'.($item->product_variant_id ?? 0))
                ?? $recipes->get($item->product_id.':0');
            if (! $recipe) {
                continue;
            }
            if ($recipe->items->isEmpty()) {
                throw ValidationException::withMessages(['items' => 'Resep '.$item->product_name.' belum memiliki bahan.']);
            }
            foreach ($recipe->items as $recipeItem) {
                $ingredient = $recipeItem->ingredient;
                if (! $ingredient || $ingredient->trashed() || ! $ingredient->is_active) {
                    throw ValidationException::withMessages(['items' => 'Bahan untuk '.$item->product_name.' tidak aktif. Hubungi pengelola inventori.']);
                }
                $quantity = InventoryQuantity::units($recipeItem->quantity) * $item->quantity;
                $item->ingredients()->create([
                    'recipe_id' => $recipe->id, 'ingredient_id' => $ingredient->id,
                    'ingredient_name' => $ingredient->name, 'unit_symbol' => $ingredient->unit->symbol,
                    'quantity' => InventoryQuantity::decimal($quantity),
                ]);
            }
        }
    }

    public function consume(Sale $sale, User $actor): void
    {
        DB::transaction(function () use ($sale, $actor): void {
            $locked = Sale::whereKey($sale->id)->lockForUpdate()->firstOrFail();
            if ($locked->inventory_deducted_at !== null || $locked->status !== 'paid') {
                return;
            }
            $items = $locked->items()->with('ingredients')->orderBy('id')->get();
            $requirements = $items->flatMap->ingredients;
            $ingredients = Ingredient::withTrashed()->with('unit')
                ->whereIn('id', $requirements->pluck('ingredient_id'))->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            foreach ($requirements->groupBy('ingredient_id') as $ingredientId => $rows) {
                $ingredient = $ingredients->get($ingredientId);
                $needed = $rows->sum(fn ($row): int => InventoryQuantity::units($row->quantity));
                if (! $ingredient || $ingredient->trashed() || ! $ingredient->is_active) {
                    throw ValidationException::withMessages(['items' => 'Bahan resep tidak aktif. Konfirmasi pembayaran dibatalkan.']);
                }
                if (InventoryQuantity::units($ingredient->stock_quantity) < $needed) {
                    throw ValidationException::withMessages(['items' => 'Stok '.$ingredient->name.' tidak cukup. Tersedia '.$ingredient->stock_quantity.' '.$ingredient->unit->symbol.', dibutuhkan '.InventoryQuantity::decimal($needed).' '.$ingredient->unit->symbol.'.']);
                }
            }
            foreach ($requirements as $row) {
                $ingredient = $ingredients->get($row->ingredient_id);
                $this->move($ingredient, $actor, -InventoryQuantity::units($row->quantity), [
                    'sale_id' => $locked->id, 'sale_item_id' => $row->sale_item_id,
                    'type' => 'consumption', 'reference' => $locked->invoice_number,
                    'reason' => 'Pemakaian resep untuk '.$locked->invoice_number,
                    'ingredient_name' => $row->ingredient_name, 'unit_symbol' => $row->unit_symbol,
                ]);
            }
            $locked->forceFill(['inventory_deducted_at' => now()])->save();
        }, 3);
    }

    public function adjust(User $actor, Ingredient $ingredient, array $data): StockMovement
    {
        return DB::transaction(function () use ($actor, $ingredient, $data): StockMovement {
            $actor = User::whereKey($actor->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($actor)->authorize('manage-inventory');
            $locked = Ingredient::with('unit')->whereKey($ingredient->id)->lockForUpdate()->firstOrFail();
            $hash = hash('sha256', json_encode([$locked->id, $data], JSON_THROW_ON_ERROR));
            $existing = StockMovement::where('idempotency_key', $data['idempotency_key'])->first();
            if ($existing) {
                if ($existing->user_id !== $actor->id || $existing->request_hash !== $hash) {
                    throw ValidationException::withMessages(['idempotency_key' => 'Kunci mutasi sudah digunakan untuk data lain. Muat ulang formulir.']);
                }

                return $existing;
            }
            if (! $locked->is_active) {
                throw ValidationException::withMessages(['ingredient' => 'Aktifkan bahan sebelum mengubah stok.']);
            }
            $quantity = InventoryQuantity::units($data['quantity']);
            if ($quantity === 0 || ! in_array($data['type'], ['receipt', 'adjustment'], true)) {
                throw ValidationException::withMessages(['quantity' => 'Jumlah mutasi harus lebih dari nol.']);
            }
            if ($data['type'] === 'adjustment' && ($data['direction'] ?? 'add') === 'remove') {
                $quantity *= -1;
            }

            return $this->move($locked, $actor, $quantity, [
                'type' => $data['type'],
                'reference' => $data['reference'] ?? 'STK-'.Str::upper((string) Str::ulid()),
                'reason' => $data['reason'], 'idempotency_key' => $data['idempotency_key'], 'request_hash' => $hash,
            ]);
        }, 3);
    }

    private function move(Ingredient $ingredient, User $actor, int $change, array $attributes): StockMovement
    {
        $before = InventoryQuantity::units($ingredient->stock_quantity);
        $after = $before + $change;
        if ($after < 0 || $after > InventoryQuantity::MAX) {
            throw ValidationException::withMessages(['quantity' => 'Mutasi menyebabkan stok negatif atau melewati batas kapasitas.']);
        }
        $ingredient->forceFill(['stock_quantity' => InventoryQuantity::decimal($after)])->save();
        $movement = $ingredient->movements()->create([
            'user_id' => $actor->id, 'quantity' => InventoryQuantity::decimal($change),
            'stock_before' => InventoryQuantity::decimal($before), 'stock_after' => InventoryQuantity::decimal($after),
            'ingredient_name' => $ingredient->name, 'unit_symbol' => $ingredient->unit->symbol,
            ...$attributes,
        ]);
        $this->audit->record($actor, 'inventory.'.$movement->type, $movement,
            ['stock_quantity' => InventoryQuantity::decimal($before)],
            ['stock_quantity' => InventoryQuantity::decimal($after), 'ingredient_id' => $ingredient->id, 'reference' => $movement->reference, 'reason' => $movement->reason]);

        return $movement;
    }
}
