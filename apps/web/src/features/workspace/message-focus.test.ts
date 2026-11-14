import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('gives persisted keyboard-focused messages a scoped visible outline independent of bubble shadows', () => {
  const css = readFileSync(new URL('./codexWorkbench.module.css', import.meta.url), 'utf8');
  const rule = css.match(
    /\.workspace\s+:global\(\.message\[data-message-id\]:focus-visible:not\(\[data-message-located='true'\]\)\)\s*\{([^}]+)\}/,
  )?.[1];
  expect(rule).toBeDefined();
  expect(rule).toMatch(/outline:\s*2px solid hsl\(var\(--primary\)\)/);
  expect(rule).toMatch(/outline-offset:\s*-2px/);
  expect(rule).toMatch(/box-shadow:\s*none/);
});
