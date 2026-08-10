import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ThemeColors } from '../constants/theme';
import { radii } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';

export function ErrorBanner({ message }: { message: string }) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.box}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    box: {
      backgroundColor: colors.dangerSoft,
      borderRadius: radii.md,
      padding: 14,
      marginBottom: 16,
    },
    text: {
      color: colors.dangerText,
      fontSize: 13,
    },
  });
}
