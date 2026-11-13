import { defineConfig } from 'vitest/config';
import config from '../../../vitest.config.ts';
export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: [
      'apps/server/src/git/git-commit-lost-response.repro.ts',
      'apps/web/src/features/workspace/components/git-commit-unknown-ui.repro.tsx',
    ],
  },
});
