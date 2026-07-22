import type { ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { PoiCategory } from '../types/database';

import { colors } from '../constants/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Bütün kateqoriyalar eyni dil: Ionicons outline, nazik xətt, oxunaqlı siluet.
 * Ölçü parent-dan gəlir — minimal UI ilə uyğun.
 */
export const CATEGORY_IONICONS: Record<PoiCategory | 'all', IoniconName> = {
  all: 'grid-outline',
  restaurant: 'restaurant-outline',
  cafe: 'cafe-outline',
  hotel: 'bed-outline',
  hostel: 'people-outline',
  home_restaurant: 'home-outline',
  guesthouse: 'business-outline',
  nature: 'leaf-outline',
  waterfall: 'rainy-outline',
  mountain: 'triangle-outline',
  lake: 'water-outline',
  historical: 'library-outline',
  monument: 'flag-outline',
  other: 'location-outline',
};

export function getCategoryIconName(category: string): IoniconName {
  return CATEGORY_IONICONS[category as PoiCategory] ?? CATEGORY_IONICONS.other;
}

type CategoryIconProps = {
  category: string;
  size?: number;
  color?: string;
};

/** Minimal, vahid kateqoriya ikonu — emoji əvəzinə. */
export function CategoryIcon({
  category,
  size = 16,
  color = colors.text,
}: CategoryIconProps) {
  return (
    <Ionicons name={getCategoryIconName(category)} size={size} color={color} />
  );
}
