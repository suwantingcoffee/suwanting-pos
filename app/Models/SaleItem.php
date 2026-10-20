<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SaleItem extends Model
{
    use HasFactory;

    protected $fillable = ['sale_id', 'product_id', 'product_variant_id', 'variant_name', 'product_name', 'sku', 'unit_price', 'quantity', 'discount', 'subtotal', 'notes'];

    protected function casts(): array
    {
        return ['unit_price' => 'decimal:2', 'discount' => 'decimal:2', 'subtotal' => 'decimal:2'];
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    public function ingredients(): HasMany
    {
        return $this->hasMany(SaleItemIngredient::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
