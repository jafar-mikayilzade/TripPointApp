/** Fetch rating-ranked POI buckets from FastAPI for AI route planning. */

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
};

export type RouteCandidateBuckets = {
  restaurants: RouteCandidatePoi[];
  accommodations: RouteCandidatePoi[];
  attractions: RouteCandidatePoi[];
};

function getApiBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!raw) {
    return null;
  }
  return raw.replace(/\/+$/, '');
}

export async function fetchRouteCandidates(
  region: string,
  perBucket = 12
): Promise<RouteCandidateBuckets | null> {
  const base = getApiBaseUrl();
  if (!base) {
    return null;
  }

  try {
    const url =
      `${base}/api/route-candidates?region=${encodeURIComponent(region.toLowerCase())}` +
      `&per_bucket=${perBucket}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
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
    };
  } catch {
    return null;
  }
}
