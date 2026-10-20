<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\View\View;

class AuditController extends Controller
{
    public function index(Request $request): View
    {
        $request->validate(['q' => ['nullable', 'string', 'max:80']]);
        $logs = AuditLog::with('user')
            ->when($request->filled('q'), fn (Builder $query) => $query->where('action', 'like', '%'.$request->string('q').'%'))
            ->latest()->paginate(20)->withQueryString();

        return view('audit.index', compact('logs'));
    }
}
