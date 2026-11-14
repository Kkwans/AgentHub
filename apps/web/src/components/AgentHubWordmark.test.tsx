// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AgentHubWordmark } from './AgentHubWordmark';

afterEach(cleanup);
it('renders a quiet textual wordmark without the provisional compact glyph', () => {
  const { container } = render(<AgentHubWordmark />);
  expect(container.querySelector('[data-brand-wordmark]')?.textContent).toBe('AgentHub');
  expect(container.querySelector('.agenthub-logo, svg, img')).toBeNull();
  const css = readFileSync(new NodeURL('./AgentHubWordmark.module.css', import.meta.url), 'utf8');
  expect(css).toContain('font-size: 20px');
  expect(css).toContain('line-height: 28px');
  expect(css).toContain('font-weight: 600');
  expect(css).toContain('color: hsl(var(--foreground))');
});
it('both expanded shells use the shared wordmark, while only AppShell retains a collapsed marker', () => {
  const shell = readFileSync(new NodeURL('../app/shell/AppShell.tsx', import.meta.url), 'utf8');
  const rail = readFileSync(
    new NodeURL('../features/workspace/components/SessionRail.tsx', import.meta.url),
    'utf8',
  );
  expect(shell).toContain('<AgentHubWordmark />');
  expect(shell).toContain('collapsed ? (');
  expect(rail).toContain('<AgentHubWordmark />');
  expect(rail).not.toContain('AgentHubLogo');
});
