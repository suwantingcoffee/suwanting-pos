<?php

namespace App\Http\Controllers;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;

class ConnectionCheckController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $started = microtime(true);
        try {
            $response = Http::connectTimeout(2)->timeout(4)->withoutRedirecting()
                ->get('https://www.gstatic.com/generate_204');
            $online = $response->status() === 204;
        } catch (ConnectionException) {
            $online = false;
        }

        return response()->json([
            'online' => $online,
            'message' => $online ? 'Server POS berhasil menjangkau internet.' : 'Server POS belum dapat menjangkau layanan pemeriksaan. Periksa jaringan lalu coba lagi.',
            'latency_ms' => $online ? (int) round((microtime(true) - $started) * 1000) : null,
            'checked_at' => now()->toIso8601String(),
        ])->header('Cache-Control', 'no-store');
    }
}
