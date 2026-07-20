import type { ComponentProps } from 'react';
import type FontAwesome from '@expo/vector-icons/FontAwesome';

import type { PoiCategory } from '../types/database';
import { getCategoryEmoji as getCategoryEmojiFn } from './categoryUtils';

export { getCategoryEmoji } from './categoryUtils';

export const CATEGORY_COLORS: Record<PoiCategory, string> = {
  restaurant: '#E07A4F',
  cafe: '#D4A017',
  hotel: '#5B8DEF',
  hostel: '#6B9AF0',
  home_restaurant: '#E07A4F',
  guesthouse: '#7AA2F7',
  nature: '#3D9B6E',
  waterfall: '#3D9B6E',
  mountain: '#5A8F6C',
  lake: '#4A90A4',
  historical: '#8B6F5C',
  monument: '#8B6F5C',
  other: '#9A9AA0',
};

export const CATEGORY_LABELS: Record<PoiCategory, string> = {
  restaurant: 'Restoran',
  cafe: 'Kafe',
  home_restaurant: 'Ev restoranı',
  hotel: 'Otel',
  hostel: 'Hostel',
  guesthouse: 'Qonaq evi',
  nature: 'Təbiət',
  waterfall: 'Şəlalə',
  mountain: 'Dağ',
  lake: 'Göl',
  historical: 'Tarixi yer',
  monument: 'Abidə',
  other: 'Digər',
};

export const CATEGORY_ICONS: Record<PoiCategory, ComponentProps<typeof FontAwesome>['name']> = {
  restaurant: 'cutlery',
  cafe: 'coffee',
  home_restaurant: 'cutlery',
  hotel: 'bed',
  hostel: 'bed',
  guesthouse: 'home',
  nature: 'tree',
  waterfall: 'tint',
  mountain: 'image',
  lake: 'tint',
  historical: 'university',
  monument: 'building',
  other: 'map-marker',
};

export function getCategoryColor(category: PoiCategory): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
}

export function getCategoryLabel(category: PoiCategory): string {
  return CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other;
}

export function getCategoryIcon(category: PoiCategory): ComponentProps<typeof FontAwesome>['name'] {
  return CATEGORY_ICONS[category] ?? CATEGORY_ICONS.other;
}

export const CATEGORY_EMOJIS: Record<PoiCategory, string> = {
  restaurant: getCategoryEmojiFn('restaurant'),
  cafe: getCategoryEmojiFn('cafe'),
  home_restaurant: getCategoryEmojiFn('home_restaurant'),
  hotel: getCategoryEmojiFn('hotel'),
  hostel: getCategoryEmojiFn('hostel'),
  guesthouse: getCategoryEmojiFn('guesthouse'),
  nature: getCategoryEmojiFn('nature'),
  waterfall: getCategoryEmojiFn('waterfall'),
  mountain: getCategoryEmojiFn('mountain'),
  lake: getCategoryEmojiFn('lake'),
  historical: getCategoryEmojiFn('historical'),
  monument: getCategoryEmojiFn('monument'),
  other: getCategoryEmojiFn('other'),
};

export type CategoryFilterId = 'all' | 'restaurant' | 'hotel' | 'nature' | 'historical';

export const CATEGORY_FILTERS: {
  id: CategoryFilterId;
  label: string;
  categories: PoiCategory[] | null;
}[] = [
  { id: 'all', label: 'Hamısı', categories: null },
  { id: 'restaurant', label: 'Restoran', categories: ['restaurant'] },
  {
    id: 'hotel',
    label: 'Otel',
    categories: ['hotel', 'hostel', 'home_restaurant', 'guesthouse'],
  },
  {
    id: 'nature',
    label: 'Təbiət',
    categories: ['nature', 'waterfall', 'mountain', 'lake'],
  },
  { id: 'historical', label: 'Tarixi', categories: ['historical', 'monument'] },
];

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

export function formatDistanceKm(distanceKm: number | null): string {
  if (distanceKm === null) {
    return '—';
  }
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }
  return `${distanceKm.toFixed(1)} km`;
}

export function getGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Google Maps linkindən lat/lng çıxarır (@lat,lng və ya ?q=lat,lng). */
export function parseCoordsFromGoogleMapsUrl(url: string): { lat: number; lng: number } | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  const atMatch = trimmed.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    return { lat: Number(atMatch[1]), lng: Number(atMatch[2]) };
  }

  const qMatch = trimmed.match(/\?q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) {
    return { lat: Number(qMatch[1]), lng: Number(qMatch[2]) };
  }

  return null;
}

export const POI_CATEGORY_OPTIONS: { value: PoiCategory; label: string }[] = [
  { value: 'restaurant', label: 'Restoran' },
  { value: 'hotel', label: 'Otel' },
  { value: 'hostel', label: 'Hostel' },
  { value: 'home_restaurant', label: 'Ev restoranı' },
  { value: 'guesthouse', label: 'Qonaq evi' },
  { value: 'nature', label: 'Təbiət' },
  { value: 'waterfall', label: 'Şəlalə' },
  { value: 'mountain', label: 'Dağ' },
  { value: 'lake', label: 'Göl' },
  { value: 'historical', label: 'Tarixi yer' },
  { value: 'monument', label: 'Abidə' },
  { value: 'other', label: 'Digər' },
];
