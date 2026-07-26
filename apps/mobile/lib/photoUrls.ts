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
