import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { CategoryIcon } from './CategoryIcon';
import type { ThemeColors } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

type PoiMarkerBubbleProps = {
  category: string;
  selected?: boolean;
};

/** Siyahıdakı CategoryIcon ilə eyni — Marker içində istifadə olunur */
export const PoiMarkerBubble = memo(function PoiMarkerBubble({
  category,
  selected = false,
}: PoiMarkerBubbleProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View
      collapsable={false}
      style={[styles.bubble, selected && styles.bubbleSelected]}
    >
      <CategoryIcon
        category={category}
        size={selected ? 18 : 16}
        color={selected ? colors.danger : colors.text}
      />
    </View>
  );
});

/** Marker snapshot — yalnız pulse / seçim / drag zamanı */
export function shouldTrackMarkerViewChanges(opts: {
  forceTrack?: boolean;
  draggable?: boolean;
  selected?: boolean;
  pulse?: boolean;
}): boolean {
  return Boolean(
    opts.pulse || opts.forceTrack || opts.draggable || opts.selected
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    bubble: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bubbleSelected: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderColor: colors.danger,
      borderWidth: 3,
      backgroundColor: colors.surface,
    },
  });
}
