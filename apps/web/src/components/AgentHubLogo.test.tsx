// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AgentHubLogo } from './AgentHubLogo';

afterEach(cleanup);
it('uses decorative AH initials without a graphic asset', () => {
  const { container } = render(<AgentHubLogo className="caller-size" />);
  const mark = container.querySelector('.agenthub-logo')!;
  expect(mark.getAttribute('aria-hidden')).toBe('true');
  expect(mark.getAttribute('data-brand-initials')).toBe('true');
  expect(mark.classList.contains('caller-size')).toBe(true);
  expect(mark.querySelector('[data-brand-monogram="true"]')?.textContent).toBe('AH');
  expect(mark.querySelector('[data-brand-glyph], img')).toBeNull();
  expect(mark.querySelector('svg')).toBeNull();
});
it('owns a transparent centered 32px typographic slot without the old mask', () => {
  const css = readFileSync(new NodeURL('./AgentHubLogo.module.css', import.meta.url), 'utf8');
  expect(css).toContain('place-items: center');
  for (const rule of [
    'width: 32px',
    'height: 32px',
    'font-size: 16px',
    'font-weight: 600',
    'letter-spacing: -0.04em',
    'background: transparent',
    'border: 0',
  ])
    expect(css).toContain(rule);
  expect(css).not.toMatch(/mask:|url\(|gradient/);
  expect(css).not.toContain('agenthub-hub-mark');
});
it('preserves 44px mobile navigation when desktop density tokens override the legacy layer', () => {
  const css = readFileSync(new NodeURL('../app/codex-theme.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 767px)'));
  expect(mobile).toContain('--sidebar-control-size: 44px');
  expect(mobile).toContain('--sidebar-item-height: 44px');
});
