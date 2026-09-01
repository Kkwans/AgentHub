import { MantineProvider, type MantineColorScheme, type MantineProviderProps } from '@mantine/core';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  AGENTHUB_THEME_STORAGE_KEY,
  createAgentHubTheme,
  resolveThemeMode,
  type ThemePreference,
} from './theme.js';

export type SidebarPreference = 'remember' | 'expanded' | 'collapsed';
export type DensityPreference = 'comfortable' | 'compact';

export const AGENTHUB_SIDEBAR_PREFERENCE_STORAGE_KEY = 'agenthub.sidebar.preference';
export const AGENTHUB_SIDEBAR_COLLAPSED_STORAGE_KEY = 'agenthub.sidebar.collapsed';
export const AGENTHUB_DENSITY_STORAGE_KEY = 'agenthub.ui.density';
export const AGENTHUB_REDUCED_MOTION_STORAGE_KEY = 'agenthub.ui.reduced-motion';

export interface AgentHubProviderProps extends Omit<MantineProviderProps, 'theme' | 'children'> {
  children: ReactNode;
  initialPreference?: ThemePreference;
}

function readPreference(initialPreference: ThemePreference): ThemePreference {
  if (typeof window === 'undefined') return initialPreference;
  const value = window.localStorage.getItem(AGENTHUB_THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : initialPreference;
}

function readSidebarPreference(): SidebarPreference {
  if (typeof window === 'undefined') return 'remember';
  const value = window.localStorage.getItem(AGENTHUB_SIDEBAR_PREFERENCE_STORAGE_KEY);
  return value === 'expanded' || value === 'collapsed' || value === 'remember' ? value : 'remember';
}

function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(AGENTHUB_SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

function readDensity(): DensityPreference {
  if (typeof window === 'undefined') return 'comfortable';
  return window.localStorage.getItem(AGENTHUB_DENSITY_STORAGE_KEY) === 'compact'
    ? 'compact'
    : 'comfortable';
}

function readReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(AGENTHUB_REDUCED_MOTION_STORAGE_KEY) === 'true';
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function AgentHubProvider({
  children,
  initialPreference = 'light',
  ...props
}: AgentHubProviderProps) {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readPreference(initialPreference),
  );
  const [sidebarPreference, setSidebarPreference] =
    useState<SidebarPreference>(readSidebarPreference);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(readSidebarCollapsed);
  const [density, setDensity] = useState<DensityPreference>(readDensity);
  const [reducedMotion, setReducedMotion] = useState(readReducedMotion);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const mode = resolveThemeMode(preference, systemDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener?.('change', listener);
    return () => media.removeEventListener?.('change', listener);
  }, []);

  const useSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
  useSafeLayoutEffect(() => {
    window.localStorage.setItem(AGENTHUB_THEME_STORAGE_KEY, preference);
    document.documentElement.dataset.agenthubTheme = mode;
    window.localStorage.setItem(AGENTHUB_SIDEBAR_PREFERENCE_STORAGE_KEY, sidebarPreference);
    window.localStorage.setItem(AGENTHUB_SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
    window.localStorage.setItem(AGENTHUB_DENSITY_STORAGE_KEY, density);
    window.localStorage.setItem(AGENTHUB_REDUCED_MOTION_STORAGE_KEY, String(reducedMotion));
    document.documentElement.dataset.agenthubDensity = density;
    document.documentElement.dataset.agenthubReducedMotion = reducedMotion ? 'true' : 'false';
  }, [density, mode, preference, reducedMotion, sidebarCollapsed, sidebarPreference]);

  useEffect(() => {
    if (sidebarPreference === 'expanded') setSidebarCollapsedState(false);
    if (sidebarPreference === 'collapsed') setSidebarCollapsedState(true);
  }, [sidebarPreference]);

  // Expose the setter without coupling feature code to Mantine's provider API.
  // Settings will consume this context in the next foundation slice.
  const theme = useMemo(() => createAgentHubTheme(mode), [mode]);
  const colorScheme: MantineColorScheme = mode;

  return (
    <MantineProvider
      {...props}
      theme={theme}
      cssVariablesResolver={() => ({
        variables: {},
        light: { '--mantine-color-dimmed': 'var(--ah-text-secondary)' },
        dark: { '--mantine-color-dimmed': 'var(--ah-text-secondary)' },
      })}
      forceColorScheme={colorScheme}
      defaultColorScheme={colorScheme}
    >
      <AgentHubThemeContext.Provider
        value={{
          density,
          mode,
          preference,
          reducedMotion,
          setDensity,
          setPreference,
          setReducedMotion,
          setSidebarCollapsed: setSidebarCollapsedState,
          setSidebarPreference,
          sidebarCollapsed,
          sidebarPreference,
        }}
      >
        {children}
      </AgentHubThemeContext.Provider>
    </MantineProvider>
  );
}

export interface AgentHubThemeContextValue {
  density: DensityPreference;
  mode: 'light' | 'dark';
  preference: ThemePreference;
  reducedMotion: boolean;
  setDensity: (density: DensityPreference) => void;
  setPreference: (preference: ThemePreference) => void;
  setReducedMotion: (reducedMotion: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarPreference: (preference: SidebarPreference) => void;
  sidebarCollapsed: boolean;
  sidebarPreference: SidebarPreference;
}

export const AgentHubThemeContext = createContext<AgentHubThemeContextValue | undefined>(undefined);

/**
 * Returns the active AgentHub theme when a feature is mounted inside the app shell.
 * Embeddable panels and isolated tests may use this hook and provide their own fallback.
 */
export function useOptionalAgentHubTheme(): AgentHubThemeContextValue | undefined {
  return useContext(AgentHubThemeContext);
}

export function useAgentHubTheme(): AgentHubThemeContextValue {
  const context = useOptionalAgentHubTheme();
  if (!context) throw new Error('useAgentHubTheme must be used inside AgentHubProvider');
  return context;
}
