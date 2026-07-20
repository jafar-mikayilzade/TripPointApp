/**
 * Soft minimal design tokens (icma-inspired).
 * Soft grey canvas, white elevated cards, calm blue accent, soft green badges.
 * Swap this file (or revert StyleSheet imports) to undo the redesign.
 */

export const colors = {
  /** Soft canvas — clearly greyer than pure white so redesign is visible */
  bg: '#E9EAEE',
  surface: '#FFFFFF',
  surfaceMuted: '#F4F4F7',
  text: '#111111',
  textSecondary: '#8E8E93',
  textMuted: '#AEAEB2',
  textOnAccent: '#FFFFFF',
  border: '#E2E3E8',
  borderSoft: '#ECECF0',
  /** Soft blue — primary actions / active tab */
  accent: '#3B82F6',
  accentPressed: '#2563EB',
  accentSoft: '#E8F1FF',
  /** Selected filter chips (dark capsule like reference) */
  chip: '#E4E5EA',
  chipSelected: '#2C2C2E',
  chipText: '#1C1C1E',
  chipTextSelected: '#FFFFFF',
  /** Soft green badges */
  success: '#1B7A4E',
  successSoft: '#E2F1E6',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  dangerText: '#B91C1C',
  tabInactive: '#AEAEB2',
  overlay: 'rgba(17, 17, 17, 0.4)',
  whatsapp: '#25D366',
  skeleton: '#E8E8ED',
  mapAccent: '#3B82F6',
} as const;

export const radii = {
  sm: 12,
  md: 16,
  lg: 24,
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

/** Soft, diffused elevation — no harsh borders needed */
export const shadows = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  fab: {
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  bar: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 8,
  },
} as const;

export const typography = {
  title: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: colors.text,
    letterSpacing: -0.4,
  },
  heading: {
    fontSize: 20,
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
