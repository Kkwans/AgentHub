import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-real',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: './real-test-results',
  reporter: [['list'], ['html', { outputFolder: './real-playwright-report', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: {
      // DH4300Plus/aarch64 has no usable X11/Mali GPU session; software
      // rendering keeps NAS-local screenshots deterministic and avoids GPU
      // process crashes taking down the Chromium worker.
      args: ['--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader'],
      ...(process.env.AGENTHUB_CHROMIUM_PATH
        ? { executablePath: process.env.AGENTHUB_CHROMIUM_PATH }
        : {}),
    },
  },
  projects: [
    {
      name: 'desktop-chrome-real',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
