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
        Schema::create('product_variants', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->string('sku', 50)->unique();
            $table->decimal('price_adjustment', 12, 2)->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['product_id', 'name']);
        });
        Schema::table('sale_items', function (Blueprint $table): void {
            $table->foreignId('product_variant_id')->nullable()->constrained()->nullOnDelete();
            $table->string('variant_name', 80)->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('sale_items', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('product_variant_id');
            $table->dropColumn('variant_name');
        });
        Schema::dropIfExists('product_variants');
    }
};
