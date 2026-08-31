import { describe, expect, it } from 'vitest';

import {
  AGENTHUB_CONTROL_HEIGHTS,
  AGENTHUB_RADIUS,
  AGENTHUB_SPACING,
  AGENTHUB_THEME_STORAGE_KEY,
  createAgentHubTheme,
  resolveThemeMode,
  type ThemePreference,
} from './theme.js';

describe('AgentHub theme bridge', () => {
  it('resolves system preference without leaking an undefined mode', () => {
    const cases: Array<[ThemePreference, boolean, 'light' | 'dark']> = [
      ['light', true, 'light'],
      ['dark', false, 'dark'],
      ['system', true, 'dark'],
      ['system', false, 'light'],
    ];

    for (const [preference, systemDark, expected] of cases) {
      expect(resolveThemeMode(preference, systemDark)).toBe(expected);
    }
  });

  it('keeps the public storage key and semantic theme values stable', () => {
    expect(AGENTHUB_THEME_STORAGE_KEY).toBe('agenthub-theme');
    expect(createAgentHubTheme('light').primaryColor).toBe('aurora');
    expect(createAgentHubTheme('dark').primaryColor).toBe('aurora');
    expect(createAgentHubTheme('light').fontFamily).toContain('Geist');
  });

  it('exposes the v1 four-pixel scale and control geometry', () => {
    expect(AGENTHUB_SPACING).toMatchObject({ one: '4px', four: '16px', eight: '32px' });
    expect(AGENTHUB_CONTROL_HEIGHTS).toEqual({ xs: '28px', sm: '32px', md: '36px', lg: '40px' });
    expect(AGENTHUB_RADIUS).toEqual({ control: '8px', surface: '12px', overlay: '14px' });
    expect(createAgentHubTheme('light').lineHeights?.md).toBe('1.55');
  });
});
