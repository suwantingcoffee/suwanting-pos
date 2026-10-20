<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Arr;

class AuditService
{
    public function record(User $user, string $action, Model $model, array $before = [], array $after = []): void
    {
        AuditLog::create([
            'user_id' => $user->id, 'action' => $action,
            'auditable_type' => $model->getMorphClass(), 'auditable_id' => $model->getKey(),
            'old_values' => Arr::except($before, ['password', 'remember_token', 'request_hash']),
            'new_values' => Arr::except($after, ['password', 'remember_token', 'request_hash']), 'ip_address' => request()->ip(),
        ]);
    }
}
