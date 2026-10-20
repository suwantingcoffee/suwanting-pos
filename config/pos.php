<?php

return [
    'demo_mode' => (bool) env('POS_DEMO_MODE', true),
    'simulate_payments' => (bool) env('POS_SIMULATE_PAYMENTS', true),
];
