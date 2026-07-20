import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../constants/theme';

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  text: {
    color: colors.dangerText,
    fontSize: 13,
  },
});
