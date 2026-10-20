<?php

namespace App\Http\Controllers;

use App\Http\Requests\CategoryRequest;
use App\Models\Category;
use App\Models\Product;
use App\Services\AuditService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\View\View;

class CategoryController extends Controller
{
    public function index(): View
    {
        return view('categories.index', ['categories' => Category::withCount('products')->orderBy('name')->paginate(15)]);
    }

    public function create(): View
    {
        return view('categories.form', ['category' => new Category(['is_active' => true])]);
    }

    public function edit(Category $category): View
    {
        return view('categories.form', compact('category'));
    }

    public function store(CategoryRequest $request, AuditService $audit): RedirectResponse
    {
        return $this->save($request, new Category, $audit);
    }

    public function update(CategoryRequest $request, Category $category, AuditService $audit): RedirectResponse
    {
        return $this->save($request, $category, $audit);
    }

    private function save(CategoryRequest $request, Category $category, AuditService $audit): RedirectResponse
    {
        DB::transaction(function () use ($request, $category, $audit): void {
            $before = $category->getAttributes();
            $category->fill($request->validated());
            $category->slug = Str::slug($category->name).'-'.substr(hash('sha256', $category->name), 0, 6);
            $category->save();
            $audit->record($request->user(), 'category.saved', $category, $before, $category->getAttributes());
        });

        return redirect()->route('categories.index')->with('success', 'Kategori disimpan.');
    }

    public function destroy(Request $request, Category $category, AuditService $audit): RedirectResponse
    {
        if (Product::withTrashed()->where('category_id', $category->id)->exists()) {
            return back()->withErrors(['category' => 'Kategori masih dipakai produk. Nonaktifkan kategori untuk menyembunyikannya dari POS.']);
        }
        DB::transaction(function () use ($request, $category, $audit): void {
            $audit->record($request->user(), 'category.deleted', $category, $category->getAttributes(), []);
            $category->delete();
        });

        return back()->with('success','Kategori dihapus.');
    }
}
