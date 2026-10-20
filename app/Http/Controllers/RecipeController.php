<?php

namespace App\Http\Controllers;

use App\Http\Requests\InventoryFilterRequest;
use App\Http\Requests\RecipeRequest;
use App\Models\Ingredient;
use App\Models\Product;
use App\Models\Recipe;
use App\Services\RecipeService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class RecipeController extends Controller
{
    public function index(InventoryFilterRequest $request): View
    {
        return view('inventory.recipes.index', ['recipes' => Recipe::with(['product', 'variant', 'items.ingredient.unit'])
            ->when($request->filled('q'), fn ($query) => $query->whereHas('product', fn ($query) => $query->where('name', 'like', '%'.$request->input('q').'%')))
            ->orderByDesc('id')->paginate(12)->withQueryString()]);
    }

    public function create(): View
    {
        return $this->form(new Recipe(['is_active' => true]));
    }

    public function edit(Recipe $recipe): View
    {
        return $this->form($recipe->load('items.ingredient.unit'));
    }

    private function form(Recipe $recipe): View
    {
        return view('inventory.recipes.form', [
            'recipe' => $recipe, 'products' => Product::with(['variants' => fn ($query) => $query->where('is_active', true)])->orderBy('name')->get(['id', 'name']),
            'ingredients' => Ingredient::with('unit')->where('is_active', true)->orderBy('name')->get(),
        ]);
    }

    public function store(RecipeRequest $request, RecipeService $recipes): RedirectResponse
    {
        $recipes->save($request->user(), $request->validated());

        return redirect()->route('inventory.recipes.index')->with('success', 'Resep disimpan.');
    }

    public function update(RecipeRequest $request, Recipe $recipe, RecipeService $recipes): RedirectResponse
    {
        $recipes->save($request->user(), $request->validated(), $recipe);

        return redirect()->route('inventory.recipes.index')->with('success', 'Resep diperbarui. Snapshot pesanan sebelumnya tetap.');
    }

    public function destroy(Request $request, Recipe $recipe, RecipeService $recipes): RedirectResponse
    {
        $recipes->deactivate($request->user(), $recipe);

        return back()->with('success', 'Resep dinonaktifkan. Pesanan baru memakai resep produk jika tersedia.');
    }
}
