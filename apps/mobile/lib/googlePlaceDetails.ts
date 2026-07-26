export type GooglePlaceDetailsRaw = {
  name?: string;
  rating: number | null;
  ratingCount: number | null;
  types: string[];
  lat?: number;
  lng?: number;
};

const EMPTY: GooglePlaceDetailsRaw = {
  rating: null,
  ratingCount: null,
  types: [],
};

const cache = new Map<string, GooglePlaceDetailsRaw>();

/**
 * Web Place Details via Places API (New) — `google.maps.places.Place`.
 * Avoids deprecated PlacesService warnings.
 */
export async function fetchPlaceDetailsWeb(
  placeId: string
): Promise<GooglePlaceDetailsRaw> {
  const id = placeId?.trim();
  if (!id || typeof document === 'undefined') {
    return EMPTY;
  }

  const hit = cache.get(id);
  if (hit) {
    return hit;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (globalThis as any).google;
    if (!g?.maps?.importLibrary) {
      return EMPTY;
    }

    const { Place } = await g.maps.importLibrary('places');
    if (!Place) {
      return EMPTY;
    }

    const place = new Place({ id });
    await place.fetchFields({
      fields: ['displayName', 'location', 'rating', 'userRatingCount', 'types'],
    });

    const displayName =
      typeof place.displayName === 'string'
        ? place.displayName
        : place.displayName?.text || place.displayName?.toString?.() || '';

    const lat =
      typeof place.location?.lat === 'function'
        ? place.location.lat()
        : typeof place.location?.lat === 'number'
          ? place.location.lat
          : undefined;
    const lng =
      typeof place.location?.lng === 'function'
        ? place.location.lng()
        : typeof place.location?.lng === 'number'
          ? place.location.lng
          : undefined;

    const types: string[] = Array.isArray(place.types) ? [...place.types] : [];
    const rating =
      typeof place.rating === 'number' && Number.isFinite(place.rating)
        ? place.rating
        : null;
    const ratingCount =
      typeof place.userRatingCount === 'number' ? place.userRatingCount : null;

    const result: GooglePlaceDetailsRaw = {
      name: String(displayName || '').trim() || undefined,
      rating,
      ratingCount,
      types,
      lat,
      lng,
    };
    cache.set(id, result);
    return result;
  } catch {
    return EMPTY;
  }
}
