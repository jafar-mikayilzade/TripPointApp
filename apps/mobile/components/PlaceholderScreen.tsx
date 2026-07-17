import FontAwesome from '@expo/vector-icons/FontAwesome';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface PlaceholderScreenProps {
  icon: ComponentProps<typeof FontAwesome>['name'];
  title: string;
  description: string;
}

export function PlaceholderScreen({ icon, title, description }: PlaceholderScreenProps) {
  return (
    <View style={styles.container}>
      <FontAwesome name={icon} size={48} color="#2563EB" style={styles.icon} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 32,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
});
