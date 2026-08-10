import type { PoiCategory } from '../types/database';

const CATEGORY_COLORS: Record<PoiCategory, string> = {
  restaurant: '#FF6D00',
  cafe: '#F59E0B',
  hotel: '#7C3AED',
  hostel: '#8B5CF6',
  home_restaurant: '#FF6D00',
  guesthouse: '#A78BFA',
  camping: '#22C55E',
  nature: '#16A34A',
  waterfall: '#0EA5E9',
  mountain: '#15803D',
  lake: '#0284C7',
  historical: '#A16207',
  monument: '#B45309',
  other: '#9A9AA0',
};

export function getCategoryColor(category: PoiCategory): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in km — single implementation for the whole app. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getDistanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  return haversineKm(from.latitude, from.longitude, to.latitude, to.longitude);
}

