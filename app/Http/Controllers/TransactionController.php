<?php

namespace App\Http\Controllers;

use App\Models\Sale;
use App\Models\Setting;
use App\Models\User;
use App\Services\AuditService;
use App\Services\InventoryService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

class TransactionController extends Controller
{
    public function index(Request $request): View
    {
        $request->validate([
            'q' => ['nullable', 'string', 'max:80'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', ...($request->filled('from') ? ['after_or_equal:from'] : [])],
            'method' => ['nullable', 'in:cash,qris,transfer'],
            'status' => ['nullable', 'in:pending,paid'],
            'cashier' => ['nullable', 'integer', 'exists:users,id'],
        ]);
        $query = Sale::with(['cashier', 'payment']);
        if ($request->user()->role === 'cashier') {
            $query->where('user_id', $request->user()->id);
        } elseif ($request->filled('cashier')) {
            $query->where('user_id', $request->integer('cashier'));
        }
        $sales = $query
            ->when($request->filled('q'), fn (Builder $query) => $query->where(fn (Builder $query) => $query->where('invoice_number', 'like', '%'.$request->string('q').'%')->orWhere('customer_name', 'like', '%'.$request->string('q').'%')))
            ->when($request->filled('from'), fn (Builder $query) => $query->whereDate('created_at', '>=', $request->input('from')))
            ->when($request->filled('to'), fn (Builder $query) => $query->whereDate('created_at', '<=', $request->input('to')))
            ->when($request->filled('method'), fn (Builder $query) => $query->whereHas('payment', fn (Builder $query) => $query->where('method', $request->input('method'))))
            ->when($request->filled('status'), fn (Builder $query) => $query->where('status', $request->input('status')))
            ->latest()->orderByDesc('id')->paginate(15)->withQueryString();

        return view('transactions.index', [
            'sales' => $sales,
            'cashiers' => $request->user()->role === 'cashier' ? collect() : User::orderBy('name')->get(['id', 'name']),
        ]);
    }

    private function authorizeSale(Request $request, Sale $sale): void
    {
        abort_unless(in_array($request->user()->role, ['owner', 'admin'], true) || $sale->user_id === $request->user()->id, 403);
    }

    public function show(Request $request, Sale $sale): View
    {
        $this->authorizeSale($request, $sale);

        return view('transactions.show', ['sale' => $sale->load(['cashier', 'items.ingredients', 'payment'])]);
    }

    public function print(Request $request, Sale $sale): View
    {
        $this->authorizeSale($request, $sale);

        return view('transactions.print', [
            'sale' => $sale->load(['cashier', 'items', 'payment']),
            'settings' => Setting::allValues(),
        ]);
    }

    public function confirm(Request $request, Sale $sale, AuditService $audit, InventoryService $inventory): RedirectResponse
    {
        $this->authorizeSale($request, $sale);
        $request->validate(['confirmed' => ['required', 'accepted']]);
        abort_unless(config('pos.simulate_payments'), 403);
        DB::transaction(function () use ($request, $sale, $audit, $inventory): void {
            $locked = Sale::whereKey($sale->id)->lockForUpdate()->firstOrFail();
            $payment = $locked->payment()->firstOrFail();
            if ($locked->status === 'paid') {
                return;
            }
            if (! in_array($payment->method, ['qris', 'transfer'], true) || ! $payment->is_simulated || $locked->status !== 'pending') {
                throw ValidationException::withMessages(['payment' => 'Pembayaran ini tidak dapat dikonfirmasi melalui simulasi.']);
            }
            $payment->update(['status' => 'paid', 'amount_received' => $locked->total, 'paid_at' => now()]);
            $locked->update(['status' => 'paid']);
            $inventory->consume($locked, $request->user());
            $audit->record($request->user(), 'payment.simulated_confirmation', $locked, ['status' => 'pending'], ['status' => 'paid']);
        }, 3);

        return back()->with('success', 'Simulasi pembayaran dikonfirmasi. Transaksi dicatat lunas.');
    }
}
