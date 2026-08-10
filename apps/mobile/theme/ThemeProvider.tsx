import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

import {
  darkColors,
  lightColors,
  type ThemeColors,
  type ThemePreference,
} from '../constants/theme';

const STORAGE_KEY = 'trippoint.themePreference';

type ThemeContextValue = {
  colors: ThemeColors;
  preference: ThemePreference;
  resolvedScheme: 'light' | 'dark';
  setPreference: (next: ThemePreference) => void;
  isDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  preference: 'system',
  resolvedScheme: 'light',
  setPreference: () => {},
  isDark: false,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (
          !cancelled &&
          (raw === 'system' || raw === 'light' || raw === 'dark')
        ) {
          setPreferenceState(raw);
        }
      } catch {
        // keep default
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const resolvedScheme: 'light' | 'dark' =
    preference === 'system'
      ? systemScheme === 'dark'
        ? 'dark'
        : 'light'
      : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: resolvedScheme === 'dark' ? darkColors : lightColors,
      preference,
      resolvedScheme,
      setPreference,
      isDark: resolvedScheme === 'dark',
    }),
    [preference, resolvedScheme, setPreference]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}
