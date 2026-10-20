<?php

use App\Http\Controllers\AuditController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\CategoryController;
use App\Http\Controllers\ConnectionCheckController;
use App\Http\Controllers\CustomerController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\IngredientController;
use App\Http\Controllers\InventoryController;
use App\Http\Controllers\InventoryUnitController;
use App\Http\Controllers\PosController;
use App\Http\Controllers\ProductController;
use App\Http\Controllers\RecipeController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\SettingsController;
use App\Http\Controllers\TransactionController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::middleware('guest')->group(function (): void {
    Route::get('/login', [AuthController::class, 'create'])->name('login');
    Route::post('/login', [AuthController::class, 'store'])->middleware('throttle:login')->name('login.store');
});
Route::post('/logout', [AuthController::class, 'destroy'])->middleware('auth')->name('logout');

Route::middleware(['auth', 'active'])->group(function (): void {
    Route::get('/', [DashboardController::class, 'index'])->name('dashboard');
    Route::get('/pos', [PosController::class, 'index'])->name('pos.index');
    Route::post('/pos/checkout', [PosController::class, 'store'])->name('pos.checkout');
    Route::get('/customers/lookup', [CustomerController::class, 'lookup'])->name('customers.lookup');
    Route::get('/customers', [CustomerController::class, 'index'])->name('customers.index');
    Route::middleware('can:manage-customers')->group(function (): void {
        Route::resource('customers', CustomerController::class)->except(['index', 'show']);
    });
    Route::resource('transactions', TransactionController::class)->only(['index', 'show'])->parameters(['transactions' => 'sale']);
    Route::get('/transactions/{sale}/print', [TransactionController::class, 'print'])->name('transactions.print');
    Route::post('/transactions/{sale}/confirm', [TransactionController::class, 'confirm'])->name('transactions.confirm');
    Route::get('/products/{product}/photo', [ProductController::class, 'photo'])->name('products.photo');
    Route::middleware(['role:owner,admin', 'can:manage-catalog'])->group(function (): void {
        Route::resource('products', ProductController::class)->except(['show']);
        Route::resource('categories', CategoryController::class)->except(['show']);
    });
    Route::middleware('role:owner')->group(function (): void {
        Route::resource('users', UserController::class)->except(['show', 'destroy']);
        Route::get('/settings', [SettingsController::class, 'edit'])->name('settings.edit');
        Route::put('/settings', [SettingsController::class, 'update'])->name('settings.update');
        Route::post('/settings/receipt-preview', [SettingsController::class, 'preview'])->name('settings.receipt-preview');
        Route::post('/settings/connection-check', ConnectionCheckController::class)->middleware('throttle:10,1')->name('settings.connection-check');
        Route::get('/reports', [ReportController::class, 'index'])->name('reports.index');
        Route::get('/audit', [AuditController::class, 'index'])->name('audit.index');
    });
    Route::prefix('inventory')->name('inventory.')->middleware('can:manage-inventory')->group(function (): void {
        Route::resource('ingredients', IngredientController::class)->except('show');
        Route::resource('units', InventoryUnitController::class)->except('show');
        Route::resource('recipes', RecipeController::class)->except('show');
        Route::get('ingredients/{ingredient}/stock', [InventoryController::class, 'create'])->name('movements.create');
        Route::post('ingredients/{ingredient}/stock', [InventoryController::class, 'store'])->name('movements.store');
        Route::get('movements', [InventoryController::class, 'index'])->name('movements.index');
        Route::get('usage', [InventoryController::class, 'usage'])->name('usage');
    });
});
