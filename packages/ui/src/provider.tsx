import {
  MantineProvider,
  type MantineColorScheme,
  type MantineProviderProps,
} from '@mantine/core';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  AGENTHUB_THEME_STORAGE_KEY,
  createAgentHubTheme,
  resolveThemeMode,
  type ThemePreference,
} from './theme.js';

export interface AgentHubProviderProps extends Omit<MantineProviderProps, 'theme' | 'children'> {
  children: ReactNode;
  initialPreference?: ThemePreference;
}

function readPreference(initialPreference: ThemePreference): ThemePreference {
  if (typeof window === 'undefined') return initialPreference;
  const value = window.localStorage.getItem(AGENTHUB_THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : initialPreference;
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
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const mode = resolveThemeMode(preference, systemDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener?.('change', listener);
    return () => media.removeEventListener?.('change', listener);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(AGENTHUB_THEME_STORAGE_KEY, preference);
    document.documentElement.dataset.agenthubTheme = mode;
  }, [mode, preference]);

  // Expose the setter without coupling feature code to Mantine's provider API.
  // Settings will consume this context in the next foundation slice.
  const theme = useMemo(() => createAgentHubTheme(mode), [mode]);
  const colorScheme: MantineColorScheme = mode;

  return (
    <MantineProvider
      {...props}
      theme={theme}
      forceColorScheme={colorScheme}
      defaultColorScheme={colorScheme}
    >
      <AgentHubThemeContext.Provider value={{ mode, preference, setPreference }}>
        {children}
      </AgentHubThemeContext.Provider>
    </MantineProvider>
  );
}

export interface AgentHubThemeContextValue {
  mode: 'light' | 'dark';
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const AgentHubThemeContext =
  createContext<AgentHubThemeContextValue | undefined>(undefined);

export function useAgentHubTheme(): AgentHubThemeContextValue {
  const context = useContext(AgentHubThemeContext);
  if (!context) throw new Error('useAgentHubTheme must be used inside AgentHubProvider');
  return context;
}
