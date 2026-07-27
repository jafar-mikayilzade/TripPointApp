import type { PoiCategory } from '../types/database';

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

/** Home map chips — cafe excluded (noisy; live/DB also skip cafe). */
export type HomeCategoryFilterId = 'all' | Exclude<PoiCategory, 'cafe'>;
