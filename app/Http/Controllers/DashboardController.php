<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Models\Sale;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\View\View;

class DashboardController extends Controller
{
    public function index(Request $request): View
    {
        $base = Sale::query()->when($request->user()->role === 'cashier', fn (Builder $query) => $query->where('user_id', $request->user()->id));
        $paid = (clone $base)->where('status', 'paid');
        $today = (clone $paid)->whereDate('created_at', today());
        $daily = (clone $paid)->where('created_at', '>=', today()->subDays(6))->selectRaw('DATE(created_at) as day, SUM(total) as total')->groupByRaw('DATE(created_at)')->pluck('total', 'day');
        $weekly = collect(range(6, 0))->map(fn (int $days) => ['label' => today()->subDays($days)->translatedFormat('D'), 'total' => (string) ($daily[today()->subDays($days)->toDateString()] ?? '0')]);
        $methods = collect(['cash' => 'Tunai', 'qris' => 'QRIS (simulasi)', 'transfer' => 'Transfer (simulasi)'])->map(fn (string $name, string $method) => ['name' => $name, 'total' => (clone $today)->whereHas('payment', fn (Builder $query) => $query->where('method', $method))->sum('total')]);

        return view('dashboard', [
            'salesTotal' => $today->sum('total'), 'saleCount' => $today->count(),
            'pending' => (clone $base)->where('status', 'pending')->count(),
            'productCount' => Product::where('is_active', true)->count(),
            'recent' => (clone $base)->with(['cashier', 'payment'])->latest()->limit(6)->get(),
            'weekly' => $weekly, 'methods' => $methods,
        ]);
    }
}
