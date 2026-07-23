/** Fetch rating-ranked POI buckets from FastAPI for AI route planning. */

import { getApiBaseUrl } from './apiBase';

export type RouteCandidatePoi = {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  lat: number;
  lng: number;
  region?: string;
  rating?: number | null;
  rating_count?: number | null;
  place_id?: string | null;
};

export type RouteCandidateBuckets = {
  restaurants: RouteCandidatePoi[];
  accommodations: RouteCandidatePoi[];
  attractions: RouteCandidatePoi[];
  source?: string;
  warnings?: string[];
};

export async function fetchRouteCandidates(
  region: string,
  perBucket = 12,
  options?: { interests?: string[] }
): Promise<RouteCandidateBuckets | null> {
  const base = getApiBaseUrl();
  if (!base) {
    return null;
  }

  try {
    const interests = (options?.interests ?? [])
      .map((i) => i.trim())
      .filter(Boolean);
    const qs = new URLSearchParams({
      region: region.toLowerCase(),
      per_bucket: String(perBucket),
      source: 'google',
    });
    if (interests.length > 0) {
      qs.set('interests', interests.join(','));
    }

    const url = `${base}/api/route-candidates?${qs.toString()}`;
    const controller = new AbortController();
    // Google Nearby (parallel) + fallback — allow a bit more than DB-only
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(url, {
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
      restaurants?: RouteCandidatePoi[];
      accommodations?: RouteCandidatePoi[];
      attractions?: RouteCandidatePoi[];
    };

    if (!data?.success) {
      return null;
    }

    return {
      restaurants: data.restaurants ?? [],
      accommodations: data.accommodations ?? [],
      attractions: data.attractions ?? [],
      source: data.source,
      warnings: data.warnings,
    };
  } catch {
    return null;
  }
}
