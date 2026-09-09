export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedThemeMode = Exclude<ThemePreference, 'system'>;

export const AGENTHUB_THEME_STORAGE_KEY = 'agenthub-theme';

export const AGENTHUB_SPACING = {
  one: '4px',
  two: '8px',
  three: '12px',
  four: '16px',
  five: '20px',
  six: '24px',
  seven: '28px',
  eight: '32px',
} as const;

export const AGENTHUB_CONTROL_HEIGHTS = {
  xs: '28px',
  sm: '32px',
  md: '36px',
  lg: '40px',
} as const;

export const AGENTHUB_RADIUS = {
  control: '8px',
  surface: '12px',
  overlay: '14px',
} as const;

const auroraLight = [
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

const auroraDark = [
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

/**
 * Stable theme description kept for consumers that used the old Mantine bridge.
 * The runtime no longer mounts Mantine; tokens.css/pinharness.css own the actual
 * CSS variables. Keeping this serialisable shape avoids forcing feature code to
 * know which component library provides the primitives.
 */
export interface AgentHubTheme {
  primaryColor: 'aurora';
  primaryShade: number;
  colors: { aurora: readonly string[] };
  defaultRadius: string;
  focusRing: 'auto';
  respectReducedMotion: true;
  fontFamily: string;
  fontFamilyMonospace: string;
  headings: { fontFamily: string; fontWeight: string };
  fontSizes: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string>;
  lineHeights: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string>;
  spacing: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string>;
  radius: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string>;
  shadows: Record<'xs' | 'sm' | 'md' | 'lg', string>;
}

export function createAgentHubTheme(mode: ResolvedThemeMode): AgentHubTheme {
  const fontFamily =
    'Geist Variable, "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", system-ui, sans-serif';
  const fontFamilyMonospace = '"JetBrains Mono", "SFMono-Regular", Consolas, monospace';
  return {
    primaryColor: 'aurora',
    primaryShade: mode === 'dark' ? 5 : 6,
    colors: { aurora: mode === 'dark' ? auroraDark : auroraLight },
    defaultRadius: 'sm',
    focusRing: 'auto',
    respectReducedMotion: true,
    fontFamily,
    fontFamilyMonospace,
    headings: { fontFamily, fontWeight: '680' },
    fontSizes: {
      xs: '0.75rem',
      sm: '0.78125rem',
      md: '0.875rem',
      lg: '1.125rem',
      xl: '1.875rem',
    },
    lineHeights: {
      xs: '1.4',
      sm: '1.4',
      md: '1.55',
      lg: '1.3',
      xl: '1.2',
    },
    spacing: {
      xs: AGENTHUB_SPACING.one,
      sm: AGENTHUB_SPACING.two,
      md: AGENTHUB_SPACING.three,
      lg: AGENTHUB_SPACING.four,
      xl: AGENTHUB_SPACING.six,
    },
    radius: {
      xs: '4px',
      sm: AGENTHUB_RADIUS.control,
      md: AGENTHUB_RADIUS.surface,
      lg: AGENTHUB_RADIUS.overlay,
      xl: '16px',
    },
    shadows: {
      xs: '0 1px 2px rgba(17,22,38,.04)',
      sm: '0 5px 18px -9px rgba(17,22,38,.13)',
      md: '0 14px 38px -18px rgba(17,22,38,.2)',
      lg: '0 28px 76px -28px rgba(17,22,38,.22)',
    },
  };
}
