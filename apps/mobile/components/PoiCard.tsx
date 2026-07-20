import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDistanceKm, getCategoryColor, getCategoryIcon, getCategoryLabel } from '../lib/poi';
import type { Poi } from '../types/database';

import { colors } from '../constants/theme';

interface PoiCardProps {
  poi: Poi;
  distanceKm: number | null;
  onPress: (poi: Poi) => void;
}

export function PoiCard({ poi, distanceKm, onPress }: PoiCardProps) {
  const color = getCategoryColor(poi.category);

  return (
    <Pressable style={styles.card} onPress={() => onPress(poi)}>
      <View style={[styles.imagePlaceholder, { backgroundColor: `${color}22` }]}>
        <FontAwesome name={getCategoryIcon(poi.category)} size={28} color={color} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {poi.name}
      </Text>
      <View style={styles.metaRow}>
        <FontAwesome name={getCategoryIcon(poi.category)} size={12} color={color} />
        <Text style={styles.category} numberOfLines={1}>
          {getCategoryLabel(poi.category)}
        </Text>
      </View>
      <Text style={styles.distance}>{formatDistanceKm(distanceKm)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 168,
    borderRadius: 24,
    backgroundColor: colors.surface,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    marginRight: 12,
    overflow: 'hidden',
  },
  imagePlaceholder: {
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginTop: 10,
    marginHorizontal: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginHorizontal: 12,
  },
  category: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  distance: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
    marginTop: 8,
    marginBottom: 12,
    marginHorizontal: 12,
  },
});
