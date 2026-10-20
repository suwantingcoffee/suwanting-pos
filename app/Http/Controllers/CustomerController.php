<?php

namespace App\Http\Controllers;

use App\Http\Requests\CustomerRequest;
use App\Models\Customer;
use App\Services\AuditService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\View\View;

class CustomerController extends Controller
{
    private function search(Request $request): Builder
    {
        $request->validate(['q' => ['nullable', 'string', 'max:120']]);

        return Customer::query()->when($request->filled('q'), function (Builder $query) use ($request): void {
            $term = '%'.$request->string('q').'%';
            $query->where(fn (Builder $query) => $query->where('name', 'like', $term)->orWhere('phone', 'like', $term));
        });
    }

    public function index(Request $request): View
    {
        $request->validate(['status' => ['nullable', 'in:active,inactive']]);
        $canManage = $request->user()->can('manage-customers');
        $query = $this->search($request);
        if (! $canManage || $request->input('status') === 'active') {
            $query->where('is_active', true);
        } elseif ($request->input('status') === 'inactive') {
            $query->where('is_active', false);
        }

        return view('customers.index', [
            'customers' => $query->select(['id', 'name', 'phone', 'email', 'is_active'])->orderBy('name')->orderBy('id')->paginate(15)->withQueryString(),
        ]);
    }

    public function lookup(Request $request): JsonResponse
    {
        return response()->json(['customers' => $this->search($request)->where('is_active', true)
            ->orderBy('name')->orderBy('id')->limit(20)->get(['id', 'name', 'phone'])]);
    }

    public function create(): View
    {
        return view('customers.form', ['customer' => new Customer(['is_active' => true])]);
    }

    public function edit(Customer $customer): View
    {
        return view('customers.form', compact('customer'));
    }

    public function store(CustomerRequest $request, AuditService $audit): RedirectResponse
    {
        return $this->save($request, new Customer, $audit);
    }

    public function update(CustomerRequest $request, Customer $customer, AuditService $audit): RedirectResponse
    {
        return $this->save($request, $customer, $audit);
    }

    private function save(CustomerRequest $request, Customer $customer, AuditService $audit): RedirectResponse
    {
        DB::transaction(function () use ($request, $customer, $audit): void {
            if ($customer->exists) {
                $customer = Customer::whereKey($customer->id)->lockForUpdate()->firstOrFail();
            }
            $before = $customer->getAttributes();
            $customer->fill($request->validated())->save();
            $audit->record($request->user(), 'customer.saved', $customer, $before, $customer->getAttributes());
        });

        return redirect()->route('customers.index')->with('success', 'Pelanggan disimpan.');
    }

    public function destroy(Request $request, Customer $customer, AuditService $audit): RedirectResponse
    {
        DB::transaction(function () use ($request, $customer, $audit): void {
            $customer = Customer::whereKey($customer->id)->lockForUpdate()->firstOrFail();
            $before = $customer->getAttributes();
            $customer->delete();
            $audit->record($request->user(), 'customer.archived', $customer, $before, $customer->getAttributes());
        });

        return redirect()->route('customers.index')->with('success', 'Pelanggan diarsipkan. Riwayat transaksi tetap tersimpan.');
    }
}
