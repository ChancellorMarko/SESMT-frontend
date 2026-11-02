import { defineConfig, devices } from '@playwright/test';

// native-workspace.spec.ts exercises browser projections with the adapter identity.
const nativeSpecs = ['**/native-auth.spec.ts', '**/native-dashboard.spec.ts', '**/native-operations.spec.ts', '**/native-permits.spec.ts', '**/native-opening.spec.ts', '**/native-documents.spec.ts', '**/native-workers.spec.ts', '**/native-teams.spec.ts', '**/native-account-binding.spec.ts'];

export default defineConfig({
  testDir: './tests/connection-ui',
  outputDir: './test-results-connection-ui',
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
  projects: [
    { name: 'chromium', testIgnore: nativeSpecs, use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-native', testMatch: nativeSpecs, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5178' } },
  ],
  webServer: [{
    command: 'node tests/connection-ui/fixtures/cookie-api-server.mjs',
    url: 'http://127.0.0.1:5177/__health',
    reuseExistingServer: false,
    timeout: 30_000,
  }, {
    command: 'npm run dev -- --port 5176 --strictPort --mode integration',
    url: 'http://127.0.0.1:5176/login',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VITE_API_MODE: 'api', VITE_AUTH_API_CONTRACT: 'adapter', VITE_API_BASE_URL: '/api/v1', API_PROXY_TARGET: 'http://127.0.0.1:5177', VITE_ACCOUNT_INVITATIONS_ENABLED: 'false', VITE_DEMO_URL: 'http://127.0.0.1:5173/login' },
  }, {
    command: 'npm run dev -- --port 5178 --strictPort --mode integration',
    url: 'http://127.0.0.1:5178/login',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VITE_API_MODE: 'api', VITE_AUTH_API_CONTRACT: 'native', VITE_API_BROWSER_PREFIX: '/browser', VITE_API_BASE_URL: '/api/v1', API_PROXY_TARGET: 'http://127.0.0.1:5177', VITE_ACCOUNT_INVITATIONS_ENABLED: 'false', VITE_DEMO_URL: 'http://127.0.0.1:5173/login' },
  }],
});
