/**
 * Calm weekend travel palette — soft, quiet, low-effort.
 * Soft grey canvas, white cards, gentle blue accent.
 * Revert this file (+ screen StyleSheets) to undo the calm redesign.
 */

export const colors = {
  /** Soft mist canvas */
  bg: '#ECEEF2',
  surface: '#FFFFFF',
  surfaceMuted: '#F5F6F8',
  text: '#1A1A1C',
  textSecondary: '#8A8A8E',
  textMuted: '#B0B0B5',
  textOnAccent: '#FFFFFF',
  border: '#E6E7EB',
  borderSoft: '#EEEFF2',
  /** Calm sky blue */
  accent: '#4A8FE8',
  accentPressed: '#3B7BD4',
  accentSoft: '#EAF2FC',
  /** Quiet chips */
  chip: '#E8E9ED',
  chipSelected: '#2C2C2E',
  chipText: '#3A3A3C',
  chipTextSelected: '#FFFFFF',
  success: '#3D8B6E',
  successSoft: '#E8F4EE',
  warning: '#C47A2C',
  warningSoft: '#FFF6E8',
  danger: '#D45B5B',
  dangerSoft: '#FCECEC',
  dangerText: '#B44545',
  tabInactive: '#B0B0B5',
  overlay: 'rgba(26, 26, 28, 0.35)',
  whatsapp: '#25D366',
  skeleton: '#E8E9ED',
  mapAccent: '#4A8FE8',
  /** Bookmark / sevimli accent (matches FavoriteButton) */
  favorite: '#E8B84A',
} as const;

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
    shadowColor: '#1A1A1C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },
  fab: {
    shadowColor: '#4A8FE8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 5,
  },
  bar: {
    shadowColor: '#1A1A1C',
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 6,
  },
} as const;

export const typography = {
  title: {
    fontSize: 30,
    fontWeight: '700' as const,
    color: colors.text,
    letterSpacing: -0.5,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: colors.text,
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: colors.text,
  },
  secondary: {
    fontSize: 14,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: colors.textSecondary,
  },
  label: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.textSecondary,
  },
} as const;
