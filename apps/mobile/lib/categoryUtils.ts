import type { PoiCategory } from '../types/database';

export function getCategoryEmoji(category: string): string {
  const map: Record<string, string> = {
    restaurant: '🍽️',
    cafe: '☕',
    hotel: '🏨',
    hostel: '🛏️',
    home_restaurant: '🏠',
    guesthouse: '🏡',
    nature: '🌿',
    waterfall: '💧',
    mountain: '⛰️',
    lake: '🏞️',
    historical: '🏛️',
    monument: '🗿',
    other: '📍',
  };
  return map[category] || '📍';
}

export function getCategoryLabel(cat: string): string {
  const map: Record<string, string> = {
    restaurant: 'Restoran',
    cafe: 'Kafe',
    hotel: 'Otel',
    hostel: 'Hostel',
    home_restaurant: 'Ev restoranı',
    guesthouse: 'Qonaq evi',
    nature: 'Təbiət',
    waterfall: 'Şəlalə',
    mountain: 'Dağ',
    lake: 'Göl',
    historical: 'Tarixi',
    monument: 'Abidə',
    other: 'Digər',
  };
  return map[cat] || cat;
}

export type HomeCategoryFilterId = 'all' | PoiCategory;

export const HOME_CATEGORY_FILTERS: {
  id: HomeCategoryFilterId;
  label: string;
  emoji: string;
}[] = [
  { id: 'all', label: 'Hamısı', emoji: '🗺️' },
  { id: 'restaurant', label: 'Restoran', emoji: '🍽️' },
  { id: 'hotel', label: 'Otel', emoji: '🏨' },
  { id: 'hostel', label: 'Hostel', emoji: '🛏️' },
  { id: 'home_restaurant', label: 'Ev restoranı', emoji: '🏠' },
  { id: 'guesthouse', label: 'Qonaq evi', emoji: '🏡' },
  { id: 'nature', label: 'Təbiət', emoji: '🌿' },
  { id: 'waterfall', label: 'Şəlalə', emoji: '💧' },
  { id: 'mountain', label: 'Dağ', emoji: '⛰️' },
  { id: 'lake', label: 'Göl', emoji: '🏞️' },
  { id: 'historical', label: 'Tarixi', emoji: '🏛️' },
  { id: 'monument', label: 'Abidə', emoji: '🗿' },
  { id: 'other', label: 'Digər', emoji: '📍' },
];

export function getHomeCategoryChipLabel(id: HomeCategoryFilterId): string {
  const item = HOME_CATEGORY_FILTERS.find((f) => f.id === id);
  if (!item) {
    return '🗺️ Hamısı';
  }
  return `${item.emoji} ${item.label}`;
}
