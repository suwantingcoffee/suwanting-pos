<?php

namespace App\Http\Controllers;

use App\Http\Requests\CheckoutRequest;
use App\Models\Category;
use App\Models\Product;
use App\Models\Setting;
use App\Services\CheckoutService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\View\View;

class PosController extends Controller
{
    public function index(): View
    {
        $settings = Setting::allValues();

        return view('pos.index', [
            'products' => Product::select(['id', 'category_id', 'name', 'sku', 'selling_price', 'photo_path', 'product_type'])
                ->where('is_active', true)->whereHas('category', fn (Builder $query) => $query->where('is_active', true))
                ->with(['category:id,name', 'variants' => fn ($query) => $query->where('is_active', true)])->orderBy('name')->get(),
            'categories' => Category::where('is_active', true)->orderBy('name')->get(),
            'taxRate' => Setting::effectiveTaxRate($settings),
            'taxEnabled' => filter_var($settings['tax_enabled'], FILTER_VALIDATE_BOOL),
        ]);
    }

    public function store(CheckoutRequest $request, CheckoutService $checkout): JsonResponse
    {
        $sale = $checkout->checkout($request->user(), $request->validated());

        return response()->json(['redirect' => route('transactions.show', $sale), 'invoice' => $sale->invoice_number]);
    }
}
