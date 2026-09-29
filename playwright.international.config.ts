import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'international.spec.ts', workers: 1, timeout: 45_000,
  reporter: [['list'], ['json', { outputFile: 'artifacts/international/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5191', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 720 } } },
  ],
  webServer: { command: 'GUAN_DISTRIBUTION=portable GUAN_PRO_NATIVE=0 GUAN_LEARNING_DISABLED=1 pnpm --config.verify-deps-before-run=false dev --port 5191', url: 'http://127.0.0.1:5191', reuseExistingServer: !process.env.CI },
});
