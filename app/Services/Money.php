<?php

namespace App\Services;

use Illuminate\Validation\ValidationException;

final class Money
{
    public static function cents(string|int|null $amount, string $field = 'amount'): int
    {
        $amount = (string) ($amount ?? '0');
        if (! preg_match('/^\d{1,9}(?:\.\d{1,2})?$/D', $amount)) {
            throw ValidationException::withMessages([$field => 'Nominal harus positif, maksimal 999.999.999,99 dan dua angka desimal.']);
        }
        $parts = explode('.', $amount);

        return (int) $parts[0] * 100 + (int) str_pad($parts[1] ?? '', 2, '0');
    }

    public static function decimal(int $cents): string
    {
        return intdiv($cents, 100).'.'.str_pad((string) ($cents % 100), 2, '0', STR_PAD_LEFT);
    }

    public static function format(string|int|float|null $amount): string
    {
        return 'Rp '.preg_replace('/,00$/', '', number_format((float) ($amount ?? 0), 2, ',', '.'));
    }
}
