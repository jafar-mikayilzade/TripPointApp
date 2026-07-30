import type { PoiCategory } from '../types/database';

const CATEGORY_COLORS: Record<PoiCategory, string> = {
  restaurant: '#C47A2C',
  cafe: '#B8952A',
  hotel: '#4A8FE8',
  hostel: '#6B9AF0',
  home_restaurant: '#C47A2C',
  guesthouse: '#7AA2F7',
  camping: '#5A8F6C',
  nature: '#3D8B6E',
  waterfall: '#3D8B6E',
  mountain: '#5A8F6C',
  lake: '#4A90A4',
  historical: '#8B6F5C',
  monument: '#8B6F5C',
  other: '#9A9AA0',
};

const CATEGORY_LABELS: Record<PoiCategory, string> = {
  restaurant: 'Restoran',
  cafe: 'Kafe',
  home_restaurant: 'Ev restoranı',
  hotel: 'Otel',
  hostel: 'Hostel',
  guesthouse: 'Qonaq evi',
  camping: 'Kemping',
  nature: 'Təbiət',
  waterfall: 'Şəlalə',
  mountain: 'Dağ',
  lake: 'Göl',
  historical: 'Tarixi yer',
  monument: 'Abidə',
  other: 'Digər',
};

export function getCategoryColor(category: PoiCategory): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
}

export function getCategoryLabel(category: PoiCategory): string {
  return CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function getDistanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

