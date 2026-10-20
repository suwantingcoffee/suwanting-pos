<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('role', 20)->default('cashier');
            $table->boolean('is_active')->default(true);
            $table->boolean('can_manage_catalog')->default(false);
            $table->boolean('can_discount')->default(false);
            $table->index(['role', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropIndex(['role', 'is_active']);
            $table->dropColumn(['role', 'is_active', 'can_manage_catalog', 'can_discount']);
        });
    }
};
