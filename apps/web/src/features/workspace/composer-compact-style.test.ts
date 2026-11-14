import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('uses one 44px text row without a second surface minimum or mobile inset', () => {
  const css = readFileSync(new URL('./codexWorkbench.module.css', import.meta.url), 'utf8');
  const surface = css.match(/\.workspace :global\(\.composer-input-surface\)\s*\{([^}]+)\}/)?.[1];
  expect(surface).toContain('min-height: 0');
  expect(surface).toContain('padding-inline: 0');
  const input = css.match(
    /\.workspace :global\(\.composer-input-surface textarea\)\s*\{([^}]+)\}/,
  )?.[1];
  expect(input).toContain('min-height: 44px');
  expect(input).toContain('padding: 10px 16px');
  expect(input).toContain('line-height: 24px');
  const card = css.match(/\.workspace :global\(\.chat-command-card\)\s*\{([^}]+)\}/)?.[1];
  expect(card).toContain('border: 1px solid var(--workspace-line)');
  expect(card).toContain('box-shadow: none');
});
