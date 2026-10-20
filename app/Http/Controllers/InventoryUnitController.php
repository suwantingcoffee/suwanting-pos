<?php

namespace App\Http\Controllers;

use App\Http\Requests\InventoryUnitRequest;
use App\Models\InventoryUnit;
use App\Services\AuditService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

class InventoryUnitController extends Controller
{
    public function index(): View
    {
        return view('inventory.units.index', ['units' => InventoryUnit::withCount('ingredients')->orderBy('name')->paginate(15)]);
    }

    public function create(): View
    {
        return view('inventory.units.form', ['unit' => new InventoryUnit]);
    }

    public function edit(InventoryUnit $unit): View
    {
        return view('inventory.units.form', compact('unit'));
    }

    public function store(InventoryUnitRequest $request, AuditService $audit): RedirectResponse
    {
        return $this->save($request, null, $audit);
    }

    public function update(InventoryUnitRequest $request, InventoryUnit $unit, AuditService $audit): RedirectResponse
    {
        return $this->save($request, $unit, $audit);
    }

    private function save(InventoryUnitRequest $request, ?InventoryUnit $unit, AuditService $audit): RedirectResponse
    {
        DB::transaction(function () use ($request, $unit, $audit): void {
            $unit = $unit ? InventoryUnit::whereKey($unit->id)->lockForUpdate()->firstOrFail() : new InventoryUnit;
            if ($unit->exists && $unit->symbol !== $request->validated('symbol') && $unit->ingredients()->exists()) {
                throw ValidationException::withMessages(['symbol' => 'Simbol satuan yang sudah dipakai tidak dapat diubah.']);
            }
            $before = $unit->getAttributes();
            $unit->fill($request->validated())->save();
            $audit->record($request->user(), 'inventory_unit.saved', $unit, $before, $unit->getAttributes());
        }, 3);

        return redirect()->route('inventory.units.index')->with('success', 'Satuan dasar disimpan.');
    }

    public function destroy(Request $request, InventoryUnit $unit, AuditService $audit): RedirectResponse
    {
        DB::transaction(function () use ($request, $unit, $audit): void {
            $unit = InventoryUnit::whereKey($unit->id)->lockForUpdate()->firstOrFail();
            if ($unit->ingredients()->exists()) {
                throw ValidationException::withMessages(['unit' => 'Satuan masih dipakai bahan, termasuk bahan yang diarsipkan.']);
            }
            $audit->record($request->user(), 'inventory_unit.deleted', $unit, $unit->getAttributes(), []);
            $unit->delete();
        }, 3);

        return back()->with('success', 'Satuan dihapus.');
    }
}
