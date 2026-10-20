<?php

namespace App\Services;

use App\Models\Ingredient;
use App\Models\Product;
use App\Models\Recipe;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class RecipeService
{
    public function __construct(private AuditService $audit) {}

    public function save(User $actor, array $data, ?Recipe $recipe = null): Recipe
    {
        Gate::forUser($actor)->authorize('manage-inventory');

        return DB::transaction(function () use ($actor, $data, $recipe): Recipe {
            $productId = $recipe?->product_id ?? $data['product_id'];
            $product = Product::whereKey($productId)->lockForUpdate()->firstOrFail();
            if ($recipe) {
                $recipe = Recipe::with('items')->whereKey($recipe->id)->lockForUpdate()->firstOrFail();
                if ((int) $data['product_id'] !== $recipe->product_id || (int) ($data['product_variant_id'] ?? 0) !== $recipe->variant_key) {
                    throw ValidationException::withMessages(['product_id' => 'Target resep tidak dapat diubah. Buat resep terpisah untuk produk/varian lain.']);
                }
            }
            $variantId = $data['product_variant_id'] ?? null;
            if ($variantId && ! $product->variants()->whereKey($variantId)->where('is_active', true)->exists()) {
                throw ValidationException::withMessages(['product_variant_id' => 'Varian tidak sesuai produk atau sudah nonaktif.']);
            }
            $duplicate = Recipe::where('product_id', $product->id)->where('variant_key', $variantId ?? 0)
                ->when($recipe, fn ($query) => $query->where('id', '!=', $recipe->id))->exists();
            if ($duplicate) {
                throw ValidationException::withMessages(['product_id' => 'Resep produk/varian ini sudah ada. Edit resep yang tersedia.']);
            }
            $ingredients = Ingredient::whereIn('id', array_column($data['items'], 'ingredient_id'))->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            foreach ($data['items'] as $item) {
                if (! $ingredients->get($item['ingredient_id'])?->is_active) {
                    throw ValidationException::withMessages(['items' => 'Resep hanya boleh memakai bahan aktif.']);
                }
                if (InventoryQuantity::units($item['quantity']) === 0) {
                    throw ValidationException::withMessages(['items' => 'Takaran bahan harus lebih dari nol.']);
                }
            }
            $before = $recipe?->toArray() ?? [];
            $recipe ??= new Recipe;
            $recipe->fill(['product_id' => $product->id, 'product_variant_id' => $variantId,
                'variant_key' => $variantId ?? 0, 'is_active' => $data['is_active']])->save();
            $recipe->items()->delete();
            $recipe->items()->createMany(array_map(fn (array $item): array => [
                'ingredient_id' => $item['ingredient_id'], 'quantity' => InventoryQuantity::decimal(InventoryQuantity::units($item['quantity'])),
            ], $data['items']));
            $this->audit->record($actor, 'recipe.saved', $recipe, $before, $recipe->load('items')->toArray());

            return $recipe;
        }, 3);
    }

    public function deactivate(User $actor, Recipe $recipe): void
    {
        Gate::forUser($actor)->authorize('manage-inventory');
        DB::transaction(function () use ($actor, $recipe): void {
            Product::withTrashed()->whereKey($recipe->product_id)->lockForUpdate()->firstOrFail();
            $recipe = Recipe::whereKey($recipe->id)->lockForUpdate()->firstOrFail();
            $before = $recipe->getAttributes();
            $recipe->update(['is_active' => false]);
            $this->audit->record($actor, 'recipe.deactivated', $recipe, $before, $recipe->getAttributes());
        }, 3);
    }
}
