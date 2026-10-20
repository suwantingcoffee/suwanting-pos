<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SaleItemIngredient extends Model
{
    protected $fillable = ['recipe_id', 'ingredient_id', 'ingredient_name', 'unit_symbol', 'quantity'];

    protected function casts(): array
    {
        return ['quantity' => 'decimal:3'];
    }

    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class)->withTrashed();
    }

    public function saleItem(): BelongsTo
    {
        return $this->belongsTo(SaleItem::class);
    }
}
