<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Ingredient extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = ['inventory_unit_id', 'name', 'sku', 'minimum_stock', 'is_active'];

    protected function casts(): array
    {
        return ['stock_quantity' => 'decimal:3', 'minimum_stock' => 'decimal:3', 'is_active' => 'boolean'];
    }

    public function unit(): BelongsTo
    {
        return $this->belongsTo(InventoryUnit::class, 'inventory_unit_id');
    }

    public function movements(): HasMany
    {
        return $this->hasMany(StockMovement::class);
    }

    public function recipeItems(): HasMany
    {
        return $this->hasMany(RecipeItem::class);
    }

    public function requirements(): HasMany
    {
        return $this->hasMany(SaleItemIngredient::class);
    }
}
