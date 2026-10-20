<?php

namespace App\Http\Controllers;

use App\Http\Requests\IngredientRequest;
use App\Http\Requests\InventoryFilterRequest;
use App\Models\Ingredient;
use App\Models\InventoryUnit;
use App\Services\AuditService;
use App\Services\InventoryQuantity;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

class IngredientController extends Controller
{
    public function index(InventoryFilterRequest $request): View
    {
        return view('inventory.ingredients.index', [
            'ingredients' => Ingredient::with('unit')
                ->when($request->filled('q'), fn ($query) => $query->where(fn ($query) => $query->where('name', 'like', '%'.$request->input('q').'%')->orWhere('sku', 'like', '%'.$request->input('q').'%')))
                ->when($request->boolean('low'), fn ($query) => $query->where('is_active', true)->whereColumn('stock_quantity', '<=', 'minimum_stock'))
                ->orderBy('name')->orderBy('id')->paginate(15)->withQueryString(),
            'lowCount' => Ingredient::where('is_active', true)->whereColumn('stock_quantity', '<=', 'minimum_stock')->count(),
        ]);
    }

    public function create(): View
    {
        return $this->form(new Ingredient(['is_active' => true, 'minimum_stock' => '0.000']));
    }

    public function edit(Ingredient $ingredient): View
    {
        return $this->form($ingredient);
    }

    private function form(Ingredient $ingredient): View
    {
        return view('inventory.ingredients.form', ['ingredient' => $ingredient, 'units' => InventoryUnit::orderBy('name')->get()]);
    }

    public function store(IngredientRequest $request, AuditService $audit): RedirectResponse
    {
        return $this->save($request, null, $audit);
    }

    public function update(IngredientRequest $request, Ingredient $ingredient, AuditService $audit): RedirectResponse
    {
        return $this->save($request, $ingredient, $audit);
    }

    private function save(IngredientRequest $request, ?Ingredient $ingredient, AuditService $audit): RedirectResponse
    {
        DB::transaction(function () use ($request, $ingredient, $audit): void {
            $data = $request->validated();
            if ($ingredient) {
                $ingredient = Ingredient::whereKey($ingredient->id)->lockForUpdate()->firstOrFail();
                if ($ingredient->inventory_unit_id !== (int) $data['inventory_unit_id']) {
                    throw ValidationException::withMessages(['inventory_unit_id' => 'Satuan dasar bahan tidak dapat diubah. Buat bahan baru untuk satuan lain.']);
                }
            } else {
                InventoryUnit::whereKey($data['inventory_unit_id'])->lockForUpdate()->firstOrFail();
            }
            $ingredient ??= new Ingredient;
            $before = $ingredient->getAttributes();
            $data['minimum_stock'] = InventoryQuantity::decimal(InventoryQuantity::units($data['minimum_stock']));
            $ingredient->fill($data)->save();
            $audit->record($request->user(), 'ingredient.saved', $ingredient, $before, $ingredient->getAttributes());
        }, 3);

        return redirect()->route('inventory.ingredients.index')->with('success', 'Bahan disimpan. Stok hanya berubah melalui mutasi atau penjualan.');
    }

    public function destroy(Request $request, Ingredient $ingredient, AuditService $audit): RedirectResponse
    {
        DB::transaction(function () use ($request, $ingredient, $audit): void {
            $ingredient = Ingredient::whereKey($ingredient->id)->lockForUpdate()->firstOrFail();
            if (InventoryQuantity::units($ingredient->stock_quantity) !== 0 || $ingredient->recipeItems()->exists() || $ingredient->requirements()->whereHas('saleItem.sale', fn ($query) => $query->where('status', 'pending'))->exists()) {
                throw ValidationException::withMessages(['ingredient' => 'Bahan masih memiliki stok, dipakai resep, atau diperlukan pembayaran menunggu. Nonaktifkan bahan atau selesaikan keterkaitannya dahulu.']);
            }
            $before = $ingredient->getAttributes();
            $ingredient->update(['is_active' => false]);
            $ingredient->delete();
            $audit->record($request->user(), 'ingredient.archived', $ingredient, $before, []);
        }, 3);

        return back()->with('success', 'Bahan diarsipkan. Riwayat mutasi tetap tersedia.');
    }
}
