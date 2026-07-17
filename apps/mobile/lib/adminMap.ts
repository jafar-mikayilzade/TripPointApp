import { REGIONS, DEFAULT_REGION_ID } from '../constants/regions';
import { getDistanceKm } from './poi';
import { supabase } from './supabase';
import type { Poi, PoiCategory } from '../types/database';

export const ADMIN_POI_CATEGORIES: PoiCategory[] = [
  'restaurant',
  'cafe',
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
};

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
}): Promise<{ data: Poi | null; error: string | null }> {
  const region = inferRegionFromCoords(params.lat, params.lng);
  const website = params.placeId
    ? `https://www.google.com/maps/place/?q=place_id:${params.placeId}`
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
    })
    .select('*')
    .single();

  if (error || !data) {
    return { data: null, error: error?.message ?? 'POI əlavə edilmədi' };
  }

  return { data: data as Poi, error: null };
}
