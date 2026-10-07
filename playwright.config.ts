import { defineConfig } from '@playwright/test';

const preview = process.env.RUN_RECORDING_SOAK === '1' || process.env.USE_PREVIEW === '1';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: preview ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1100 },
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chrome', use: { channel: 'chrome' } },
    { name: 'edge', use: { channel: 'msedge' } },
  ],
  webServer: {
    command: preview ? 'npm run preview' : 'npm run dev',
    url: preview ? 'http://127.0.0.1:4173' : 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
