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

