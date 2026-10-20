<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StockMovement extends Model
{
    protected $fillable = ['ingredient_id', 'user_id', 'sale_id', 'sale_item_id', 'type', 'quantity', 'stock_before', 'stock_after', 'ingredient_name', 'unit_symbol', 'reference', 'reason', 'idempotency_key', 'request_hash'];

    protected function casts(): array
    {
        return ['quantity' => 'decimal:3', 'stock_before' => 'decimal:3', 'stock_after' => 'decimal:3'];
    }

    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class)->withTrashed();
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }
}
