/** POI richness for home sort + display priority (photo, price, contact, extras). */

type RichnessInput = {
  phone?: string | null;
  website?: string | null;
  external_url?: string | null;
  description?: string | null;
  address?: string | null;
  opening_hours?: string | null;
  cuisine?: string | null;
  thumbnail_url?: string | null;
  photo_urls?: string[] | null;
  photoUrls?: string[] | null;
  photoUrl?: string | null;
  amenities?: string[] | null;
  rating?: number | null;
  averageRating?: number | null;
  rating_count?: number | null;
  ratingCount?: number | null;
  price_from?: number | null;
  hotel_class?: number | null;
};

function truthy(v: unknown): boolean {
  return v != null && String(v).trim() !== '' && String(v) !== 'null';
}

function photoCount(poi: RichnessInput): number {
  const urls = poi.photoUrls ?? poi.photo_urls;
  let n = 0;
  if (Array.isArray(urls)) {
    n = urls.filter((u) => truthy(u)).length;
  }
  if (truthy(poi.photoUrl) || truthy(poi.thumbnail_url)) {
    n = Math.max(n, 1);
  }
  return n;
}

/**
 * Higher = more complete listing. Photos, price and contact weigh heaviest.
 */
export function poiRichnessScore(poi: RichnessInput): number {
  let score = 0;
  const photos = photoCount(poi);
  score += Math.min(photos, 8) * 25;

  if (truthy(poi.phone)) score += 40;
  if (poi.price_from != null && Number.isFinite(Number(poi.price_from))) score += 35;

  const desc = poi.description ? String(poi.description).trim() : '';
  if (desc.length >= 20) score += 30;
  else if (desc.length > 0) score += 10;

  if (truthy(poi.website) || truthy(poi.external_url)) score += 20;
  if (truthy(poi.address)) score += 15;
  if (truthy(poi.opening_hours)) score += 10;
  if (truthy(poi.cuisine)) score += 8;
  if (Array.isArray(poi.amenities) && poi.amenities.length > 0) {
    score += Math.min(poi.amenities.length, 6) * 3;
  }
  if (poi.hotel_class != null) score += 5;

  const rating = poi.averageRating ?? poi.rating;
  if (typeof rating === 'number' && Number.isFinite(rating)) {
    score += Math.round(rating * 8);
  }
  const count = poi.ratingCount ?? poi.rating_count ?? 0;
  if (typeof count === 'number' && Number.isFinite(count)) {
    score += Math.min(count, 80);
  }

  return score;
}

/** Sort comparator: richer first, then higher rating. */
export function comparePoisByRichness(
  a: RichnessInput,
  b: RichnessInput
): number {
  const rb = poiRichnessScore(b);
  const ra = poiRichnessScore(a);
  if (rb !== ra) return rb - ra;
  const ratingA = a.averageRating ?? a.rating ?? -1;
  const ratingB = b.averageRating ?? b.rating ?? -1;
  if (ratingB !== ratingA) return Number(ratingB) - Number(ratingA);
  const ca = a.ratingCount ?? a.rating_count ?? 0;
  const cb = b.ratingCount ?? b.rating_count ?? 0;
  return Number(cb) - Number(ca);
}
