/**
 * TripPoint brand tokens — teal (light) + forest/gold (dark).
 * Prefer useThemeColors() so screens react to dark mode.
 */

export type ThemeColors = {
  bg: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textOnAccent: string;
  border: string;
  borderSoft: string;
  accent: string;
  accentPressed: string;
  accentSoft: string;
  /** Brand teal — CTAs in dark mode stay teal; tab active uses accent (gold). */
  brand: string;
  brandPressed: string;
  chip: string;
  chipSelected: string;
  chipText: string;
  chipTextSelected: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  dangerText: string;
  tabInactive: string;
  overlay: string;
  whatsapp: string;
  skeleton: string;
  favorite: string;
  /** "Trip" half of wordmark (navy in light) */
  wordmarkTrip: string;
};

export const lightColors: ThemeColors = {
  bg: '#F4F7F6',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF3F2',
  text: '#1A2B2C',
  textSecondary: '#5A6B6C',
  textMuted: '#8A9A9B',
  textOnAccent: '#FFFFFF',
  border: '#D8E3E2',
  borderSoft: '#E8F0EF',
  accent: '#0E7A7D',
  accentPressed: '#0A6366',
  accentSoft: '#E4F4F4',
  brand: '#0E7A7D',
  brandPressed: '#0A6366',
  chip: '#E4EBEA',
  chipSelected: '#0E7A7D',
  chipText: '#3A4A4B',
  chipTextSelected: '#FFFFFF',
  success: '#1D7A6D',
  successSoft: '#E5F5F1',
  warning: '#C47A2C',
  warningSoft: '#FFF6E8',
  danger: '#D45B5B',
  dangerSoft: '#FCECEC',
  dangerText: '#B44545',
  tabInactive: '#9AABAC',
  overlay: 'rgba(13, 44, 36, 0.4)',
  whatsapp: '#25D366',
  skeleton: '#E4EBEA',
  favorite: '#D4AF37',
  wordmarkTrip: '#1A2B48',
};

export const darkColors: ThemeColors = {
  bg: '#0D2C24',
  surface: '#152E28',
  surfaceMuted: '#1A3830',
  text: '#F2F5F4',
  textSecondary: '#A8B8B4',
  textMuted: '#7A8E88',
  textOnAccent: '#0D2C24',
  border: '#2A4540',
  borderSoft: '#1F3A34',
  accent: '#D4AF37',
  accentPressed: '#C5A059',
  accentSoft: '#2A3F30',
  brand: '#1D9A8E',
  brandPressed: '#178078',
  chip: '#1F3A34',
  chipSelected: '#D4AF37',
  chipText: '#C5D4D0',
  chipTextSelected: '#0D2C24',
  success: '#3DAB8E',
  successSoft: '#1A3830',
  warning: '#E0A04A',
  warningSoft: '#2A3830',
  danger: '#E07070',
  dangerSoft: '#2A2828',
  dangerText: '#F0A0A0',
  tabInactive: '#6A7E78',
  overlay: 'rgba(0, 0, 0, 0.55)',
  whatsapp: '#25D366',
  skeleton: '#1F3A34',
  favorite: '#D4AF37',
  wordmarkTrip: '#F2F5F4',
};

/** Default light export for non-reactive call sites; prefer useThemeColors(). */
export const colors: ThemeColors = lightColors;

export const radii = {
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const shadows = {
  card: {
    shadowColor: '#0D2C24',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 2,
  },
  bar: {
    shadowColor: '#0D2C24',
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 6,
  },
} as const;

export type ThemePreference = 'system' | 'light' | 'dark';
