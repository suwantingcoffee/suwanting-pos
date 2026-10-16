import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4179',
    headless: true,
    launchOptions: { ...(process.env.POS_CHROME_PATH ? { executablePath: process.env.POS_CHROME_PATH } : {}) },
    ...(process.env.POS_CHROME_PATH ? {} : { channel: 'chrome' }),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `"${process.execPath}" frontend/node_modules/vite/bin/vite.js frontend --host 127.0.0.1 --port 4179 --strictPort --mode test`,
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://pos-ui.supabase.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_browser_test_public_key' },
    timeout: 60000,
  },
});
