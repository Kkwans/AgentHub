import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps every mobile workspace tab at least 44px in both axes despite narrow-phone padding', () => {
  const css = readFileSync(new URL('./workspace.module.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 767px)'));
  const rule = mobile.match(/\.mobileTabs button\s*\{([^}]+)\}/)?.[1];
  expect(rule).toMatch(/min-width:\s*44px/);
  expect(rule).toMatch(/min-height:\s*44px/);
  expect(rule).toMatch(/flex:\s*0 0 auto/);
  const narrow = mobile.slice(mobile.indexOf('@media (max-width: 480px)'));
  const narrowRule = narrow.match(/\.mobileTabs button\s*\{([^}]+)\}/)?.[1];
  expect(narrowRule).not.toMatch(/(?:min-)?width:/);
  expect(mobile).toContain('overflow-x: auto');
});
