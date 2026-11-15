import { defineConfig, devices } from '@playwright/test';

// Standalone HTML design evidence only. No app server, API or provider validation.
export default defineConfig({
  testDir: './tests/design',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'prototype-test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/prototype-playwright-report', open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--disable-gpu'] },
  },
});
