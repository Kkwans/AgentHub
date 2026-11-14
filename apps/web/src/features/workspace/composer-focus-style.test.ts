import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps one visible keyboard boundary instead of a separated outline and shadow halo', () => {
  const css = readFileSync(new URL('./codexWorkbench.module.css', import.meta.url), 'utf8');
  const rule = css.match(/\.chat-command-card:has\(textarea:focus-visible\)\)\s*\{([^}]+)\}/)?.[1];
  expect(rule).toMatch(
    /outline:\s*2px solid\s+color-mix\(in srgb, hsl\(var\(--foreground-muted\)\) 70%, hsl\(var\(--surface\)\)\)/,
  );
  expect(rule).toContain('outline-offset: -1px');
  expect(rule).toContain('border-color: transparent');
  expect(rule).toContain('box-shadow: none');
});
