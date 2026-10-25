import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/connection-ui',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5176',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5176 --strictPort --mode integration',
    url: 'http://127.0.0.1:5176/login',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VITE_API_MODE: 'api', VITE_API_BASE_URL: '/api/v1', VITE_ACCOUNT_INVITATIONS_ENABLED: 'false' },
  },
});
