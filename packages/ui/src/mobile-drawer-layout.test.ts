import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('explicitly gives the native drawer viewport height instead of intrinsic content height', () => {
  const source = readFileSync(new URL('./pinharness/mobile-drawer.tsx', import.meta.url), 'utf8');
  expect(source).toContain('mobile-drawer m-0 h-dvh max-h-dvh overflow-hidden');
  expect(source).toContain('flex-col');
  expect(source).toContain('requestClose');
});
