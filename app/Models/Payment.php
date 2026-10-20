<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payment extends Model
{
    use HasFactory;

    protected $fillable = ['sale_id', 'method', 'amount_received', 'amount_due', 'change_amount', 'status', 'is_simulated', 'paid_at'];

    protected function casts(): array
    {
        return ['amount_received' => 'decimal:2', 'amount_due' => 'decimal:2', 'change_amount' => 'decimal:2', 'is_simulated' => 'boolean', 'paid_at' => 'datetime'];
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }
}
