import Constants from 'expo-constants';

import { REGIONS, DEFAULT_REGION_ID } from '../constants/regions';
import { getDistanceKm } from './poi';
import { supabase } from './supabase';
import type { Poi, PoiCategory } from '../types/database';

export const ADMIN_POI_CATEGORIES: PoiCategory[] = [
  'restaurant',
  'hostel',
  'hotel',
  'home_restaurant',
  'guesthouse',
  'nature',
  'waterfall',
  'mountain',
  'lake',
  'historical',
  'monument',
  'other',
];

export type GoogleMapPoiPayload = {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  rating?: number | null;
  ratingCount?: number | null;
  /** Google tipindən təxmin edilən kateqoriya (admin dəyişə bilər). */
  suggestedCategory?: PoiCategory | null;
};

function getGoogleMapsKey(): string {
  return (
    Constants.expoConfig?.extra?.googleMapsKey ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
    ''
  );
}

/** Google Place type → TripPoint kateqoriyası (tapılmasa null). */
export function mapGoogleTypesToCategory(types: string[] | undefined): PoiCategory | null {
  if (!types?.length) return null;

  const TYPE_TO_CATEGORY: Record<string, PoiCategory> = {
    restaurant: 'restaurant',
    food: 'restaurant',
    meal_takeaway: 'restaurant',
    meal_delivery: 'restaurant',
    cafe: 'restaurant',
    bakery: 'restaurant',
    bar: 'restaurant',
    lodging: 'hotel',
    hotel: 'hotel',
    motel: 'hotel',
    resort_hotel: 'hotel',
    hostel: 'hostel',
    guest_house: 'guesthouse',
    campground: 'nature',
    park: 'nature',
    natural_feature: 'nature',
    rv_park: 'nature',
    museum: 'historical',
    art_gallery: 'historical',
    church: 'historical',
    hindu_temple: 'historical',
    mosque: 'historical',
    synagogue: 'historical',
    place_of_worship: 'historical',
    tourist_attraction: 'historical',
    landmark: 'monument',
    monument: 'monument',
    cemetery: 'historical',
    aquarium: 'other',
    zoo: 'other',
    amusement_park: 'other',
  };

  for (const t of types) {
    const mapped = TYPE_TO_CATEGORY[t];
    if (mapped && ADMIN_POI_CATEGORIES.includes(mapped)) {
      return mapped;
    }
  }
  return null;
}

export type GooglePlaceDetails = {
  name?: string;
  rating: number | null;
  ratingCount: number | null;
  suggestedCategory: PoiCategory | null;
};

/** Place Details — rating + types (admin tap-to-add). */
export async function fetchGooglePlaceRating(placeId: string): Promise<GooglePlaceDetails> {
  const empty: GooglePlaceDetails = {
    rating: null,
    ratingCount: null,
    suggestedCategory: null,
  };
  const key = getGoogleMapsKey();
  if (!placeId || !key) {
    return empty;
  }

  try {
    const url =
      'https://maps.googleapis.com/maps/api/place/details/json' +
      `?place_id=${encodeURIComponent(placeId)}` +
      '&fields=name,rating,user_ratings_total,types' +
      `&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      status?: string;
      result?: {
        name?: string;
        rating?: number;
        user_ratings_total?: number;
        types?: string[];
      };
    };
    if (data.status !== 'OK' || !data.result) {
      return empty;
    }
    const rating =
      typeof data.result.rating === 'number' && Number.isFinite(data.result.rating)
        ? data.result.rating
        : null;
    const ratingCount =
      typeof data.result.user_ratings_total === 'number'
        ? data.result.user_ratings_total
        : null;
    return {
      name: data.result.name,
      rating,
      ratingCount,
      suggestedCategory: mapGoogleTypesToCategory(data.result.types),
    };
  } catch {
    return empty;
  }
}

/** Koordinata ən yaxın region id (məs. seki, quba). */
export function inferRegionFromCoords(lat: number, lng: number): string {
  let bestId = DEFAULT_REGION_ID;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const region of REGIONS) {
    const distance = getDistanceKm(
      { latitude: lat, longitude: lng },
      { latitude: region.latitude, longitude: region.longitude }
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = region.id;
    }
  }

  return bestId;
}

export async function fetchIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return false;
  }

  return data.role === 'admin';
}

export async function updatePoiCoordinates(
  poiId: string,
  lat: number,
  lng: number
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('pois')
    .update({
      lat,
      lng,
      updated_at: new Date().toISOString(),
    })
    .eq('id', poiId);

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

export async function insertApprovedPoiFromGoogle(params: {
  name: string;
  category: PoiCategory;
  lat: number;
  lng: number;
  placeId?: string;
  userId: string;
  rating?: number | null;
  ratingCount?: number | null;
}): Promise<{ data: Poi | null; error: string | null }> {
  const region = inferRegionFromCoords(params.lat, params.lng);
  const website = params.placeId
    ? `https://www.google.com/maps/place/?q=place_id:${params.placeId}`
    : null;

  const rating =
    typeof params.rating === 'number' && Number.isFinite(params.rating)
      ? params.rating
      : null;
  const rating_count =
    typeof params.ratingCount === 'number' && Number.isFinite(params.ratingCount)
      ? params.ratingCount
      : null;

  const { data, error } = await supabase
    .from('pois')
    .insert({
      name: params.name.trim(),
      category: params.category,
      lat: params.lat,
      lng: params.lng,
      region,
      status: 'approved',
      submitted_by: params.userId,
      description: null,
      address: null,
      phone: null,
      website,
      rating,
      rating_count,
    })
    .select('*')
    .single();

  if (error || !data) {
    return { data: null, error: error?.message ?? 'POI əlavə edilmədi' };
  }

  return { data: data as Poi, error: null };
}
