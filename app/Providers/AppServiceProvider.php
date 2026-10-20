<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        Blade::directive('money', fn (string $expression): string => "<?php echo e(\\App\\Services\\Money::format({$expression})); ?>");
        RateLimiter::for('login', fn (Request $request) => Limit::perMinute(5)->by(Str::lower((string) $request->input('email')).'|'.$request->ip()));
        Gate::define('discount', fn (User $user): bool => $user->canOperate() && ($user->isOwner() || ($user->role === 'admin' && $user->can_discount)));
        Gate::define('manage-catalog', fn (User $user): bool => $user->canOperate() && ($user->isOwner() || ($user->role === 'admin' && $user->can_manage_catalog)));
        Gate::define('manage-users', fn (User $user): bool => $user->canOperate() && $user->isOwner());
        Gate::define('manage-customers', fn (User $user): bool => $user->canOperate() && in_array($user->role, ['owner', 'admin'], true));
        Gate::define('manage-inventory', fn (User $user): bool => $user->canOperate() && ($user->isOwner() || ($user->role === 'admin' && $user->can_manage_catalog)));
    }
}
