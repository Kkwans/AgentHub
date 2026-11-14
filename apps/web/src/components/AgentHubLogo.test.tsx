// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AgentHubLogo } from './AgentHubLogo';

afterEach(cleanup);
it('uses the same decorative brand asset in a centered slot rather than a navigation icon', () => {
  const { container } = render(<AgentHubLogo className="caller-size" />);
  const mark = container.querySelector('.agenthub-logo')!;
  expect(mark.getAttribute('aria-hidden')).toBe('true');
  expect(mark.classList.contains('caller-size')).toBe(true);
  expect(mark.querySelector('[data-brand-glyph="true"]')).not.toBeNull();
  expect(mark.querySelector('svg')).toBeNull();
});
it('owns centering and compensates the generated asset artboard without hardcoding a theme color', () => {
  const css = readFileSync(new NodeURL('./AgentHubLogo.module.css', import.meta.url), 'utf8');
  expect(css).toContain('place-items: center');
  expect(css).toContain('background: currentColor');
  expect(css).toContain('agenthub-hub-mark.png');
  expect(css).toContain('149%');
});
it('preserves 44px mobile navigation when desktop density tokens override the legacy layer', () => {
  const css = readFileSync(new NodeURL('../app/codex-theme.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 767px)'));
  expect(mobile).toContain('--sidebar-control-size: 44px');
  expect(mobile).toContain('--sidebar-item-height: 44px');
});
