<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('sale_id')->constrained()->cascadeOnDelete();
            $table->string('method', 20);
            $table->decimal('amount_received', 12, 2);
            $table->decimal('amount_due', 12, 2);
            $table->decimal('change_amount', 12, 2)->default(0);
            $table->string('status', 20)->default('paid');
            $table->boolean('is_simulated')->default(true);
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
            $table->index(['method', 'status']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};
