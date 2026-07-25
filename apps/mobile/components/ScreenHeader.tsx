import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../constants/theme';
import { layout, useResponsiveLayout } from '../lib/layout';

type Props = {
  title: string;
  subtitle?: string;
  /** Right-side actions (ProfileCornerButton, add, …) */
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Universal screen header: title never clashes with corner actions on any width.
 */
export function ScreenHeader({ title, subtitle, right, style }: Props) {
  const { padH, titleSize, subtitleSize } = useResponsiveLayout();

  return (
    <View style={[styles.wrap, { paddingHorizontal: padH }, style]}>
      <View style={layout.screenHeader}>
        <View style={layout.screenHeaderText}>
          <Text style={[styles.title, { fontSize: titleSize }]} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.subtitle, { fontSize: subtitleSize }]}
              numberOfLines={2}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  title: {
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  subtitle: {
    marginTop: 3,
    fontWeight: '500',
    color: colors.textMuted,
    lineHeight: 16,
  },
  right: {
    flexShrink: 0,
    paddingTop: 2,
  },
});
