import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const css = readFileSync(new URL('./pinharness.css', import.meta.url), 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf('\n' + selector + ' {');
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
};
it('gives quiet tool rows a persistent border and readable title/summary hierarchy', () => {
  expect(rule('.tool-entry-card')).toContain('border: 1px solid hsl(var(--border) / 0.65)');
  const title = rule('.tool-entry-badge');
  expect(title).toContain('font-family: var(--font-sans)');
  expect(title).toContain('font-size: 14px');
  expect(title).toContain('font-weight: 600');
  expect(title).toContain('color: hsl(var(--foreground))');
  expect(rule('.tool-entry-summary')).toContain('font-size: 13px');
  expect(rule('.tool-entry-summary')).toContain('white-space: pre');
  expect(rule('.tool-entry-summary')).toContain('max-height: 1.5em');
  expect(rule('.tool-entry-summary')).toContain('color: hsl(var(--foreground-muted))');
});
it('keeps 44px controls, keyboard focus and bounded public-thought scrolling', () => {
  expect(rule('.tool-entry-trigger')).toContain('min-height: 2.75rem');
  expect(rule('.process-thought-trigger')).toContain('min-height: 2.75rem');
  expect(rule('.process-thought-trigger:focus-visible')).toContain('outline: 2px solid');
  expect(rule('.process-thought-label')).toContain('font-size: 14px');
  expect(rule('.process-thought-body')).toContain('font-size: 14px');
  expect(rule('.process-thought-body')).toContain('--conversation-prose-size: 14px');
  expect(rule('.process-thought-body')).toContain('max-height: 22rem');
  expect(rule('.process-thought-body')).toContain('overflow: auto');
});
