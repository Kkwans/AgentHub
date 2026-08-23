import { describe, expect, it } from 'vitest';

import {
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
    expect(createAgentHubTheme('light').fontFamily).toContain('Inter');
  });
});
