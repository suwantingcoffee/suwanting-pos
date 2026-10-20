<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Setting extends Model
{
    use HasFactory;

    protected $fillable = ['key', 'value'];

    public const DEFAULTS = [
        'shop_name' => 'Suwanting Coffee', 'shop_address' => '', 'shop_phone' => '', 'shop_email' => '',
        'tax_enabled' => '1', 'tax_rate' => '0.00',
        'receipt_header' => '', 'receipt_footer' => "Terima kasih sudah singgah.\nSuwanting Coffee",
        'receipt_paper' => '80', 'receipt_show_cashier' => '1', 'receipt_show_customer' => '1',
        'receipt_show_sku' => '0', 'receipt_auto_print' => '1',
    ];

    public static function allValues(): array
    {
        return array_replace(self::DEFAULTS, static::pluck('value', 'key')->all());
    }

    public static function effectiveTaxRate(?array $settings = null): string
    {
        $settings ??= static::allValues();

        return filter_var($settings['tax_enabled'], FILTER_VALIDATE_BOOL) ? (string) $settings['tax_rate'] : '0.00';
    }
}
