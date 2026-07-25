import { StyleSheet, useWindowDimensions } from 'react-native';

/**
 * App-wide layout rules so narrow phones never blow up rows/titles.
 * Row + Text: always flexShrink + minWidth:0 on the text side.
 */
export const layout = StyleSheet.create({
  flexFill: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  flexText: {
    flexShrink: 1,
    minWidth: 0,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  /** Title + trailing actions (profile, add, …) */
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  screenHeaderText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  /** Two equal action buttons that wrap on narrow screens */
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionBtn: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 0,
    maxWidth: '100%',
  },
  screenPad: {
    paddingHorizontal: 16,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
});

export type ResponsiveLayout = ReturnType<typeof useResponsiveLayout>;

/** Kiçik / qısa telefonlar üçün dinamik ölçü — bütün ekranlarda istifadə et. */
export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const isCompact = width < 360;
  const isNarrow = width < 340;
  const isShort = height < 680;

  return {
    width,
    height,
    isCompact,
    isNarrow,
    isShort,
    padH: isCompact ? 12 : 16,
    titleSize: isCompact ? 20 : 22,
    subtitleSize: isCompact ? 11 : 12,
    bodySize: isCompact ? 13 : 14,
    chipFontSize: isCompact ? 11 : 12,
    /** 1 col on very narrow; 2 col otherwise (flexBasis avoids gap overflow) */
    interestBasis: isNarrow ? ('100%' as const) : ('47%' as const),
    actionBasis: isNarrow ? ('100%' as const) : ('47%' as const),
    formBottomPad: isShort ? 20 : 28,
    tabLabelMode: (isCompact ? 'short' : 'full') as 'short' | 'full',
  };
}
