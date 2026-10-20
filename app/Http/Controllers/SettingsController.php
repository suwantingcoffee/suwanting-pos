<?php

namespace App\Http\Controllers;

use App\Http\Requests\SettingsRequest;
use App\Models\Payment;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\Setting;
use App\Models\User;
use App\Services\AuditService;
use App\Services\Money;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\View\View;

class SettingsController extends Controller
{
    public function edit(): View
    {
        return view('settings.edit', ['settings' => Setting::allValues()]);
    }

    public function update(SettingsRequest $request, AuditService $audit): RedirectResponse
    {
        DB::transaction(function () use ($request, $audit): void {
            foreach ($request->validated() as $key => $value) {
                $setting = Setting::firstOrNew(['key' => $key]);
                $before = $setting->getAttributes();
                $setting->value = is_bool($value) ? (string) (int) $value : (string) $value;
                if ($setting->exists && ! $setting->isDirty('value')) {
                    continue;
                }
                $setting->save();
                $audit->record($request->user(), 'settings.updated', $setting, $before, $setting->getAttributes());
            }
        });

        return back()->with('success', 'Pengaturan disimpan.');
    }

    public function preview(SettingsRequest $request): View
    {
        $settings = array_replace(Setting::allValues(), $request->validated());
        $rate = Setting::effectiveTaxRate($settings);
        $tax = intdiv(2400000 * Money::cents($rate) + 5000, 10000);
        $total = Money::decimal(2400000 + $tax);
        $sale = new Sale([
            'invoice_number' => 'PRATINJAU-STRUK', 'customer_name' => 'Pelanggan Contoh',
            'subtotal' => '24000.00', 'discount' => '0.00', 'tax_rate' => $rate,
            'tax_amount' => Money::decimal($tax), 'total' => $total, 'status' => 'paid', 'is_demo' => true,
        ]);
        $sale->created_at = now();
        $sale->setRelation('cashier', new User(['name' => 'Kasir Contoh']));
        $sale->setRelation('items', collect([new SaleItem([
            'product_name' => 'Kopi Susu Suwanting', 'variant_name' => 'Iced', 'sku' => 'KSS-001-ICED',
            'quantity' => 1, 'unit_price' => '24000.00', 'subtotal' => '24000.00', 'notes' => 'Less ice',
        ])]));
        $sale->setRelation('payment', new Payment([
            'method' => 'cash', 'amount_received' => $total, 'change_amount' => '0.00', 'is_simulated' => false,
        ]));

        return view('transactions.print', ['sale' => $sale, 'settings' => $settings, 'preview' => true]);
    }
}
