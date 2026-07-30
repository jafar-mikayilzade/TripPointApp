import { getApiBaseUrl } from './apiBase';
import { getAuthHeaders } from './authHeaders';
import type { PoiCategory } from '../types/database';

export type UpsertGooglePlaceInput = {
  place_id: string;
  name: string;
  lat: number;
  lng: number;
  category?: PoiCategory | string | null;
  region?: string | null;
  rating?: number | null;
  rating_count?: number | null;
};

export type UpsertGooglePlaceResult = {
  id: string;
  created: boolean;
};

/** FastAPI service-role upsert — returns DB UUID for favorites. */
export async function upsertGooglePlace(
  input: UpsertGooglePlaceInput
): Promise<UpsertGooglePlaceResult> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error('API ünvanı yoxdur (EXPO_PUBLIC_API_URL).');
  }

  const authHeaders = await getAuthHeaders();
  if (!authHeaders) {
    throw new Error('Daxil olmaq lazımdır.');
  }

  const category =
    input.category && String(input.category).toLowerCase() === 'cafe'
      ? 'restaurant'
      : input.category || 'other';

  const res = await fetch(`${base}/api/pois/upsert-google-place`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      place_id: input.place_id,
      name: input.name,
      lat: input.lat,
      lng: input.lng,
      category,
      region: input.region ?? null,
      rating: input.rating ?? null,
      rating_count: input.rating_count ?? null,
    }),
  });

  const data = (await res.json()) as {
    ok?: boolean;
    id?: string;
    created?: boolean;
    detail?: { message?: string } | string;
  };

  if (!res.ok || !data.id) {
    const message =
      typeof data.detail === 'object' && data.detail?.message
        ? data.detail.message
        : typeof data.detail === 'string'
          ? data.detail
          : 'Məkan bazaya yazılmadı';
    throw new Error(message);
  }

  return { id: data.id, created: Boolean(data.created) };
}
