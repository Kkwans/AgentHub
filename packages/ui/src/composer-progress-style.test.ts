import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./pinharness.css', import.meta.url), 'utf8');
const rules = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))].map(
    (match) => match[1]!,
  );
};

it('keeps passive progress visually unboxed in both themes and completion states', () => {
  const base = rules('.composer-plan-status');
  expect(base[0]).toContain('background: transparent');
  expect(base[0]).toContain('border-color: transparent');
  expect(base[0]).toContain('border-radius: 0');
  expect(base[0]).toContain('box-shadow: none');
  const complete = rules(".composer-plan-status[data-complete='true']");
  expect(complete).toHaveLength(1);
  expect(complete[0]).toContain('color: hsl(var(--success))');
  expect(complete[0]).not.toMatch(/background|border|box-shadow/);
  for (const override of base.slice(1)) {
    expect(override).not.toMatch(/background|border|box-shadow/);
  }
});

it('preserves the numeric progress track and mobile box metrics without shrinking real buttons', () => {
  expect(rules('.composer-plan-track')[0]).toContain('height: 2px');
  expect(rules('.composer-plan-track-fill')[0]).toContain('background: currentColor');
  expect(rules('.composer-plan-track-fill')[0]).toContain('transform-origin: left center');
  expect(rules('.composer-plan-status').at(-1)).toContain('min-width: 3.5rem');
  expect(rules('.composer-plan-status').at(-1)).toContain('padding-inline: 0.5rem');
  expect(css).toContain(`.composer-context-control,
  .composer-terminal-launcher-slot .terminal-launcher {
    min-width: 44px;
    min-height: 44px;`);
});
