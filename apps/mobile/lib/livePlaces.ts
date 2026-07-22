/** Home / Qur map: live Google Places via FastAPI (DB fallback on server). */

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
  viewport?: boolean;
  hubs_used?: string[];
};

export type LivePlacesQuery = {
  category?: string | null;
  limit?: number;
  /** Viewport progressive load */
  lat?: number;
  lng?: number;
  radius?: number;
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

/** Rough viewport radius (m) from longitudeDelta. */
export function radiusMetersFromLongitudeDelta(longitudeDelta: number): number {
  const deg = Math.max(0.01, Math.min(longitudeDelta, 1.5));
  // ~111km per degree at equator; clamp tourism-useful range
  const meters = deg * 111_000 * 0.45;
  return Math.round(Math.max(2_500, Math.min(meters, 22_000)));
}

/** Cache key bucket so tiny pans do not refetch. */
export function viewportTileKey(
  lat: number,
  lng: number,
  longitudeDelta: number
): string {
  const radius = radiusMetersFromLongitudeDelta(longitudeDelta);
  // Coarser grid when zoomed out
  const step = longitudeDelta > 0.35 ? 0.08 : longitudeDelta > 0.12 ? 0.04 : 0.02;
  const rLat = Math.round(lat / step) * step;
  const rLng = Math.round(lng / step) * step;
  const rBucket = Math.round(radius / 1500) * 1500;
  return `${rLat.toFixed(3)}:${rLng.toFixed(3)}:${rBucket}`;
}

export function mergeLivePlacesById<T extends { id: string; place_id?: string | null }>(
  existing: T[],
  incoming: T[]
): T[] {
  const map = new Map<string, T>();
  for (const row of existing) {
    const key = String(row.place_id || row.id);
    if (key) map.set(key, row);
  }
  for (const row of incoming) {
    const key = String(row.place_id || row.id);
    if (!key) continue;
    map.set(key, row);
  }
  return Array.from(map.values());
}

export async function fetchLivePlaces(
  region: string,
  options?: LivePlacesQuery
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
    if (
      typeof options?.lat === 'number' &&
      Number.isFinite(options.lat) &&
      typeof options?.lng === 'number' &&
      Number.isFinite(options.lng)
    ) {
      qs.set('lat', String(options.lat));
      qs.set('lng', String(options.lng));
      if (typeof options.radius === 'number' && Number.isFinite(options.radius)) {
        qs.set('radius', String(Math.round(options.radius)));
      }
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
      viewport?: boolean;
      hubs_used?: string[];
    };

    if (!data?.success) {
      return null;
    }

    return {
      places: data.places ?? [],
      source: data.source ?? 'google',
      warnings: data.warnings ?? [],
      viewport: Boolean(data.viewport),
      hubs_used: data.hubs_used ?? [],
    };
  } catch {
    return null;
  }
}
