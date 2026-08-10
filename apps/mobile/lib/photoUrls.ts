/** Pick best available photo URL for a display size. */

export type PhotoSize = 'thumb' | 'medium' | 'original';

export type PhotoUrlFields = {
  photo_url?: string | null;
  thumb_url?: string | null;
  medium_url?: string | null;
};

export function pickPhotoUrl(
  photo: PhotoUrlFields | null | undefined,
  size: PhotoSize = 'original'
): string | null {
  if (!photo) {
    return null;
  }
  const original = photo.photo_url?.trim() || null;
  const medium = photo.medium_url?.trim() || null;
  const thumb = photo.thumb_url?.trim() || null;

  if (size === 'thumb') {
    return thumb || medium || original;
  }
  if (size === 'medium') {
    return medium || original || thumb;
  }
  return original || medium || thumb;
}

type PoiPhotoSources = {
  thumbnail_url?: string | null;
  photo_urls?: string[] | null;
};

/**
 * Unique gallery URLs for a POI: approved poi_photos first, then photo_urls / thumbnail_url.
 */
export function collectPoiPhotoUrls(
  poi: PoiPhotoSources | null | undefined,
  photos: PhotoUrlFields[] | null | undefined,
  size: PhotoSize = 'medium'
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  function push(url: string | null | undefined) {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed.startsWith('http') || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }

  for (const photo of photos ?? []) {
    push(pickPhotoUrl(photo, size));
  }

  if (Array.isArray(poi?.photo_urls)) {
    for (const url of poi.photo_urls) {
      push(url);
    }
  }

  push(poi?.thumbnail_url);
  return out;
}
