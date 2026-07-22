import type { PoiCategory } from '../types/database';

/** @deprecated UI üçün CategoryIcon istifadə et — yalnız köhnə mətn/paylaşım üçün. */
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
}[] = [
  { id: 'all', label: 'Hamısı' },
  { id: 'restaurant', label: 'Restoran' },
  { id: 'hotel', label: 'Otel' },
  { id: 'hostel', label: 'Hostel' },
  { id: 'home_restaurant', label: 'Ev restoranı' },
  { id: 'guesthouse', label: 'Qonaq evi' },
  { id: 'nature', label: 'Təbiət' },
  { id: 'waterfall', label: 'Şəlalə' },
  { id: 'mountain', label: 'Dağ' },
  { id: 'lake', label: 'Göl' },
  { id: 'historical', label: 'Tarixi' },
  { id: 'monument', label: 'Abidə' },
  { id: 'other', label: 'Digər' },
];

export function getHomeCategoryChipLabel(id: HomeCategoryFilterId): string {
  const item = HOME_CATEGORY_FILTERS.find((f) => f.id === id);
  return item?.label ?? 'Hamısı';
}
