import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    // Live suites start real Codex processes and disposable PGlite servers;
    // running files in parallel causes false startup timeouts and competing
    // provider state. Keep the release gate deterministic and serial.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
