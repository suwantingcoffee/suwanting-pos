<?php

namespace App\Http\Controllers;

use App\Http\Requests\UserRequest;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

class UserController extends Controller
{
    public function index(): View
    {
        return view('users.index', ['users' => User::orderBy('role')->orderBy('name')->paginate(15)]);
    }

    public function create(): View
    {
        return view('users.form', ['user' => new User(['is_active' => true])]);
    }

    public function store(UserRequest $request, AuditService $audit): RedirectResponse
    {
        return $this->save($request, new User, $audit);
    }

    public function edit(User $user): View
    {
        return view('users.form', compact('user'));
    }

    public function update(UserRequest $request, User $user, AuditService $audit): RedirectResponse
    {
        return $this->save($request, $user, $audit);
    }

    private function save(UserRequest $request, User $user, AuditService $audit): RedirectResponse
    {
        DB::transaction(function () use ($request, $user, $audit): void {
            User::where('role', 'owner')->orderBy('id')->lockForUpdate()->get();
            $actor = User::findOrFail($request->user()->id);
            abort_unless($actor->isOwner() && $actor->is_active, 403);
            if ($user->exists && $user->id === $request->user()->id && ($request->validated('role') !== 'owner' || ! $request->boolean('is_active'))) {
                throw ValidationException::withMessages(['role' => 'Owner tidak dapat menonaktifkan atau menurunkan role akunnya sendiri.']);
            }
            $before = $user->getAttributes();
            $data = $request->safe()->except(['password']);
            $data['email'] = strtolower($data['email']);
            $data['can_discount'] = $data['role'] === 'admin' && $request->boolean('can_discount');
            $data['can_manage_catalog'] = $data['role'] === 'admin' && $request->boolean('can_manage_catalog');
            if ($request->filled('password')) {
                $data['password'] = Hash::make((string) $request->string('password'));
            } else {
                unset($data['password']);
            }
            $user->fill($data)->save();
            $audit->record($request->user(), $user->wasRecentlyCreated ? 'user.created' : 'user.updated', $user, $before, $user->getAttributes());
        });

        return redirect()->route('users.index')->with('success', 'Pengguna disimpan.');
    }
}
