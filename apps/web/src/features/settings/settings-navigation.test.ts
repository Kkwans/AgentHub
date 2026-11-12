import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const css = readFileSync(new URL('./settings.module.css', import.meta.url), 'utf8');
const mobile = css.slice(css.indexOf('@media (max-width: 760px)'));
describe('Settings mobile navigation layout contract', () => {
  it('exposes three columns rather than a horizontally hidden tail', () => {
    expect(mobile).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(mobile).not.toContain('overflow-x: auto');
    expect(mobile).toContain('min-height: 44px');
  });
  it('allows longer labels to wrap without widening the navigation', () => {
    expect(mobile).toContain('white-space: normal');
    expect(mobile).toContain('overflow-wrap: anywhere');
  });
  it('retains the desktop navigation and original section links', () => {
    expect(css.slice(0, css.indexOf('@media (max-width: 760px)'))).not.toContain(
      'repeat(3, minmax(0, 1fr))',
    );
    const source = readFileSync(new URL('./pages/SettingsPageView.tsx', import.meta.url), 'utf8');
    expect(source).toContain('to={`/settings/${id}`}');
    expect(source).toContain('aria-label="设置分区"');
  });
});
