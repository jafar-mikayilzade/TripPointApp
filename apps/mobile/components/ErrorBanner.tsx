import { StyleSheet, Text, View } from 'react-native';

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  text: {
    color: '#B91C1C',
    fontSize: 13,
  },
});
