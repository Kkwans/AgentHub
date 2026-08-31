import { createTheme, type MantineColorsTuple, type MantineThemeOverride } from '@mantine/core';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedThemeMode = Exclude<ThemePreference, 'system'>;

export const AGENTHUB_THEME_STORAGE_KEY = 'agenthub-theme';

const auroraLight: MantineColorsTuple = [
  '#f0edff',
  '#e9e4ff',
  '#cfc5ff',
  '#b5a5ff',
  '#9b8bff',
  '#806eff',
  '#6246f5',
  '#573beb',
  '#4c32d8',
  '#3d27bd',
];

const auroraDark: MantineColorsTuple = [
  '#292246',
  '#332a56',
  '#51458c',
  '#685bb0',
  '#7869ed',
  '#8a7aff',
  '#9a8dff',
  '#a77bff',
  '#b8a9ff',
  '#c9c0ff',
];

export function resolveThemeMode(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedThemeMode {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

export function createAgentHubTheme(mode: ResolvedThemeMode): MantineThemeOverride {
  return createTheme({
    primaryColor: 'aurora',
    primaryShade: mode === 'dark' ? 5 : 6,
    colors: { aurora: mode === 'dark' ? auroraDark : auroraLight },
    defaultRadius: 'md',
    focusRing: 'auto',
    respectReducedMotion: true,
    fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif',
    fontFamilyMonospace: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    headings: {
      fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif',
      fontWeight: '650',
    },
    fontSizes: {
      xs: '0.71875rem',
      sm: '0.8125rem',
      md: '0.875rem',
      lg: '1rem',
      xl: '1.375rem',
    },
    spacing: {
      xs: '0.25rem',
      sm: '0.5rem',
      md: '0.75rem',
      lg: '1rem',
      xl: '1.5rem',
    },
    radius: {
      xs: '7px',
      sm: '9px',
      md: '10px',
      lg: '13px',
      xl: '17px',
    },
    shadows: {
      xs: '0 1px 2px rgba(17,22,38,.04)',
      sm: '0 2px 8px rgba(17,22,38,.055)',
      md: '0 8px 24px -10px rgba(17,22,38,.13)',
      lg: '0 18px 48px -18px rgba(17,22,38,.22)',
    },
  });
}
