<?php

namespace App\Services;

use Illuminate\Validation\ValidationException;

final class InventoryQuantity
{
    public const int MAX = 999999999999;

    public static function units(string|int $quantity, string $field = 'quantity'): int
    {
        if (! preg_match('/^\d{1,9}(?:\.\d{1,3})?$/D', (string) $quantity)) {
            throw ValidationException::withMessages([$field => 'Gunakan jumlah positif dengan maksimal tiga angka desimal.']);
        }
        $parts = explode('.', (string) $quantity);

        return (int) $parts[0] * 1000 + (int) str_pad($parts[1] ?? '', 3, '0');
    }

    public static function decimal(int $units): string
    {
        $absolute = abs($units);

        return ($units < 0 ? '-' : '').intdiv($absolute, 1000).'.'.str_pad((string) ($absolute % 1000), 3, '0', STR_PAD_LEFT);
    }
}
