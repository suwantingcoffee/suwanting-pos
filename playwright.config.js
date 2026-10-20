import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/static/browser',
    fullyParallel: false,
    workers: 1,
    globalTeardown: './tests/static/browser-teardown.mjs',
    timeout: 30000,
    use: { baseURL: 'http://127.0.0.1:4175/suwanting-pos/', headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}), trace: 'retain-on-failure' },
    webServer: { command: 'node tests/static/browser-server.mjs', url: 'http://127.0.0.1:4175/__test/health', reuseExistingServer: false, timeout: 60000 },
});
