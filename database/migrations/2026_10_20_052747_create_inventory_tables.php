<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_units', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 80);
            $table->string('symbol', 20)->unique();
            $table->timestamps();
        });
        Schema::create('ingredients', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('inventory_unit_id')->constrained()->restrictOnDelete();
            $table->string('name', 120);
            $table->string('sku', 40)->unique();
            $table->decimal('stock_quantity', 15, 3)->default(0);
            $table->decimal('minimum_stock', 15, 3)->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();
        });
        Schema::create('recipes', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            $table->foreignId('product_variant_id')->nullable()->constrained()->restrictOnDelete();
            $table->unsignedBigInteger('variant_key')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['product_id', 'variant_key']);
        });
        Schema::create('recipe_items', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('recipe_id')->constrained()->cascadeOnDelete();
            $table->foreignId('ingredient_id')->constrained()->restrictOnDelete();
            $table->decimal('quantity', 12, 3);
            $table->timestamps();
            $table->unique(['recipe_id', 'ingredient_id']);
        });
        Schema::create('sale_item_ingredients', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('sale_item_id')->constrained()->restrictOnDelete();
            $table->foreignId('recipe_id')->constrained()->restrictOnDelete();
            $table->foreignId('ingredient_id')->constrained()->restrictOnDelete();
            $table->string('ingredient_name', 120);
            $table->string('unit_symbol', 20);
            $table->decimal('quantity', 15, 3);
            $table->timestamps();
            $table->unique(['sale_item_id', 'ingredient_id']);
        });
        Schema::create('stock_movements', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('ingredient_id')->constrained()->restrictOnDelete();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->foreignId('sale_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignId('sale_item_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('type', 20);
            $table->decimal('quantity', 15, 3);
            $table->decimal('stock_before', 15, 3);
            $table->decimal('stock_after', 15, 3);
            $table->string('ingredient_name', 120);
            $table->string('unit_symbol', 20);
            $table->string('reference', 120);
            $table->string('reason', 500);
            $table->uuid('idempotency_key')->nullable()->unique();
            $table->string('request_hash', 64)->nullable();
            $table->timestamps();
            $table->unique(['sale_item_id', 'ingredient_id']);
            $table->index(['ingredient_id', 'created_at']);
            $table->index(['type', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_movements');
        Schema::dropIfExists('sale_item_ingredients');
        Schema::dropIfExists('recipe_items');
        Schema::dropIfExists('recipes');
        Schema::dropIfExists('ingredients');
        Schema::dropIfExists('inventory_units');
    }
};
