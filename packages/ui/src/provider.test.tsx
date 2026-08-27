// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentHubProvider, useAgentHubTheme, useOptionalAgentHubTheme } from './provider.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })),
);

function ThemeProbe() {
  const { mode, preference, setPreference } = useAgentHubTheme();
  return (
    <div>
      <output aria-label="当前主题">{mode}</output>
      <output aria-label="主题偏好">{preference}</output>
      <button type="button" onClick={() => setPreference('dark')}>
        切换深色
      </button>
    </div>
  );
}

function OptionalThemeProbe() {
  const theme = useOptionalAgentHubTheme();
  return <output aria-label="可选主题">{theme?.mode ?? 'unmanaged'}</output>;
}

describe('AgentHubProvider', () => {
  it('allows embeddable UI to provide a fallback outside the provider', () => {
    render(<OptionalThemeProbe />);
    expect(screen.getByRole('status', { name: '可选主题' })).toHaveTextContent('unmanaged');
  });

  it('uses light by default and persists a user theme preference', () => {
    render(
      <AgentHubProvider>
        <ThemeProbe />
      </AgentHubProvider>,
    );

    expect(screen.getByRole('status', { name: '当前主题' })).toHaveTextContent('light');
    fireEvent.click(screen.getByRole('button', { name: '切换深色' }));
    expect(screen.getByRole('status', { name: '当前主题' })).toHaveTextContent('dark');
    expect(window.localStorage.getItem('agenthub-theme')).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-agenthub-theme', 'dark');
  });
});
