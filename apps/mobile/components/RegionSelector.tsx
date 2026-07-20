import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import type { Region } from '../constants/regions';

import { colors } from '../constants/theme';

interface RegionSelectorProps {
  regions: Region[];
  selectedRegionId: string;
  onSelect: (regionId: string) => void;
}

export function RegionSelector({ regions, selectedRegionId, onSelect }: RegionSelectorProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {regions.map((region) => {
        const isSelected = region.id === selectedRegionId;
        return (
          <Pressable
            key={region.id}
            onPress={() => onSelect(region.id)}
            style={[styles.chip, isSelected && styles.chipSelected]}
          >
            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{region.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.chip,
    marginRight: 8,
  },
  chipSelected: {
    backgroundColor: colors.chipSelected,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.chipText,
  },
  chipTextSelected: {
    color: colors.textOnAccent,
  },
});
