/** Home map: live Google Places via FastAPI (DB fallback on server). */

import type { Poi, PoiCategory } from '../types/database';

export type LivePlace = {
  id: string;
  place_id?: string | null;
  name: string;
  category: PoiCategory | string;
  description?: string | null;
  lat: number;
  lng: number;
  region?: string | null;
  rating?: number | null;
  rating_count?: number | null;
  address?: string | null;
};

export type LivePlacesResult = {
  places: LivePlace[];
  source: string;
  warnings: string[];
};

function getApiBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!raw) {
    return null;
  }
  return raw.replace(/\/+$/, '');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDatabasePoiId(id: string): boolean {
  return UUID_RE.test(id);
}

export function livePlaceToPoi(place: LivePlace, regionId: string): Poi {
  const placeId = place.place_id || place.id;
  return {
    id: String(place.id || placeId),
    name: place.name,
    description: place.description ?? place.address ?? null,
    category: (place.category || 'other') as PoiCategory,
    status: 'approved',
    region: place.region || regionId,
    lat: Number(place.lat),
    lng: Number(place.lng),
    address: place.address ?? null,
    phone: null,
    website: null,
    rating: place.rating ?? null,
    rating_count: place.rating_count ?? null,
    place_id: placeId,
    submitted_by: 'google',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function fetchLivePlaces(
  region: string,
  options?: { category?: string | null; limit?: number }
): Promise<LivePlacesResult | null> {
  const base = getApiBaseUrl();
  if (!base) {
    return null;
  }

  try {
    const qs = new URLSearchParams({
      region: region.toLowerCase(),
      limit: String(options?.limit ?? 60),
    });
    if (options?.category && options.category !== 'all') {
      qs.set('category', options.category);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 22_000);
    const res = await fetch(`${base}/api/live-places?${qs.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as {
      success?: boolean;
      source?: string;
      warnings?: string[];
      places?: LivePlace[];
    };

    if (!data?.success) {
      return null;
    }

    return {
      places: data.places ?? [],
      source: data.source ?? 'google',
      warnings: data.warnings ?? [],
    };
  } catch {
    return null;
  }
}
