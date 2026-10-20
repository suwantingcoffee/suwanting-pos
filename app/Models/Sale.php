<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Sale extends Model
{
    use HasFactory;

    protected $fillable = ['user_id', 'invoice_number', 'customer_id', 'customer_name', 'status', 'subtotal', 'discount', 'tax_rate', 'tax_amount', 'total', 'idempotency_key', 'request_hash', 'is_demo', 'notes'];

    protected function casts(): array
    {
        return ['subtotal' => 'decimal:2', 'discount' => 'decimal:2', 'tax_rate' => 'decimal:2', 'tax_amount' => 'decimal:2', 'total' => 'decimal:2', 'is_demo' => 'boolean', 'inventory_deducted_at' => 'datetime'];
    }

    public function cashier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class)->withTrashed();
    }

    public function items(): HasMany
    {
        return $this->hasMany(SaleItem::class);
    }

    public function payment(): HasOne
    {
        return $this->hasOne(Payment::class);
    }
}
