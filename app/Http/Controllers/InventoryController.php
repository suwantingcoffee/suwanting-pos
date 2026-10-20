<?php

namespace App\Http\Controllers;

use App\Http\Requests\InventoryFilterRequest;
use App\Http\Requests\StockMovementRequest;
use App\Models\Ingredient;
use App\Models\StockMovement;
use App\Services\InventoryService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Str;
use Illuminate\View\View;

class InventoryController extends Controller
{
    public function create(Ingredient $ingredient): View
    {
        return view('inventory.movements.form', ['ingredient' => $ingredient->load('unit'), 'idempotencyKey' => (string) Str::uuid()]);
    }

    public function store(StockMovementRequest $request, Ingredient $ingredient, InventoryService $inventory): RedirectResponse
    {
        $inventory->adjust($request->user(), $ingredient, $request->validated());

        return redirect()->route('inventory.movements.index', ['ingredient_id' => $ingredient->id])->with('success', 'Mutasi stok dicatat.');
    }

    private function filtered(InventoryFilterRequest $request): Builder
    {
        return StockMovement::query()
            ->when($request->filled('ingredient_id'), fn ($query) => $query->where('ingredient_id', $request->integer('ingredient_id')))
            ->when($request->filled('from'), fn ($query) => $query->where('created_at', '>=', $request->input('from').' 00:00:00'))
            ->when($request->filled('to'), fn ($query) => $query->where('created_at', '<', $request->date('to')->addDay()->startOfDay()));
    }

    public function index(InventoryFilterRequest $request): View
    {
        return view('inventory.movements.index', [
            'movements' => $this->filtered($request)->with(['user', 'sale'])
                ->when($request->filled('type'), fn ($query) => $query->where('type', $request->input('type')))
                ->when($request->filled('q'), fn ($query) => $query->where(fn ($query) => $query->where('reference', 'like', '%'.$request->input('q').'%')->orWhere('ingredient_name', 'like', '%'.$request->input('q').'%')))
                ->orderByDesc('id')->paginate(20)->withQueryString(),
            'ingredients' => Ingredient::withTrashed()->orderBy('name')->get(['id', 'name']),
        ]);
    }

    public function usage(InventoryFilterRequest $request): View
    {
        return view('inventory.usage', [
            'usage' => $this->filtered($request)->where('type', 'consumption')
                ->select(['ingredient_id', 'ingredient_name', 'unit_symbol'])
                ->selectRaw('-SUM(quantity) as used_quantity, COUNT(DISTINCT sale_id) as sale_count')
                ->groupBy('ingredient_id', 'ingredient_name', 'unit_symbol')->orderBy('ingredient_name')->paginate(20)->withQueryString(),
            'ingredients' => Ingredient::withTrashed()->orderBy('name')->get(['id', 'name']),
        ]);
    }
}
