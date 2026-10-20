<?php

namespace App\Http\Controllers;

use App\Http\Requests\ProductRequest;
use App\Models\Category;
use App\Models\Product;
use App\Services\AuditService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\View\View;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ProductController extends Controller
{
    public function index(Request $request): View
    {
        $request->validate(['q' => ['nullable', 'string', 'max:120']]);

        return view('products.index', ['products' => Product::with('category')->when($request->filled('q'), fn ($query) => $query->where(fn ($query) => $query->where('name', 'like', '%'.$request->string('q').'%')->orWhere('sku', 'like', '%'.$request->string('q').'%')))->orderBy('name')->paginate(12)->withQueryString()]);
    }

    public function create(): View
    {
        return $this->form(new Product(['is_active' => true]));
    }

    public function edit(Product $product): View
    {
        return $this->form($product->load('variants'));
    }

    private function form(Product $product): View
    {
        return view('products.form', ['product' => $product, 'categories' => Category::orderBy('name')->get()]);
    }

    public function store(ProductRequest $request, AuditService $audit): RedirectResponse
    {
        $this->save($request, new Product, $audit);

        return redirect()->route('products.index')->with('success', 'Produk berhasil ditambahkan.');
    }

    public function update(ProductRequest $request, Product $product, AuditService $audit): RedirectResponse
    {
        $this->save($request, $product, $audit);

        return redirect()->route('products.index')->with('success', 'Produk berhasil diperbarui.');
    }

    private function save(ProductRequest $request, Product $product, AuditService $audit): void
    {
        DB::transaction(function () use ($request, $product, $audit): void {
            $before = $product->getAttributes();
            $data = $request->safe()->except(['variants', 'photo']);
            if ($request->hasFile('photo')) {
                $data['photo_path'] = $request->file('photo')->store('product-photos', 'local');
            }
            $product->fill($data)->save();
            $product->variants()->update(['is_active' => false]);
            foreach ($request->validated('variants', []) ?? [] as $variant) {
                $product->variants()->updateOrCreate(['name' => $variant['name']], [
                    'sku' => $product->sku.'-'.substr(hash('sha256', $variant['name']), 0, 8),
                    'price_adjustment' => $variant['price_adjustment'], 'is_active' => true,
                ]);
            }
            $audit->record($request->user(), empty($before) ? 'product.created' : 'product.updated', $product, $before, $product->getAttributes());
        });
    }

    public function destroy(Request $request, Product $product, AuditService $audit): RedirectResponse
    {
        DB::transaction(function () use ($request, $product, $audit): void {
            $audit->record($request->user(), 'product.archived', $product, $product->getAttributes(), []);
            $product->delete();
        });

        return back()->with('success', 'Produk diarsipkan. Riwayat penjualan tetap tersedia.');
    }

    public function photo(Product $product): StreamedResponse
    {
        abort_unless($product->photo_path && Storage::disk('local')->exists($product->photo_path), 404);

        return Storage::disk('local')->response($product->photo_path,null,['Cache-Control' => 'private, max-age=3600', 'X-Content-Type-Options' => 'nosniff']);
    }
}
