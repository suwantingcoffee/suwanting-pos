<?php

namespace App\Http\Controllers;

use App\Models\Payment;
use App\Models\Sale;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\View\View;

class ReportController extends Controller
{
    public function index(Request $request): View
    {
        $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date']]);
        $sales = Sale::where('status', 'paid')->when($request->filled('from'), fn (Builder $q) => $q->whereDate('created_at', '>=', $request->date('from')))->when($request->filled('to'), fn (Builder $q) => $q->whereDate('created_at', '<=', $request->date('to')));

        return view('reports.index', ['total' => $sales->sum('total'), 'count' => $sales->count(), 'byMethod' => Payment::whereIn('sale_id', (clone $sales)->select('id'))->selectRaw('method, SUM(amount_due) as total')->groupBy('method')->pluck('total', 'method'), 'from' => $request->input('from'), 'to' => $request->input('to')]);
    }
}
