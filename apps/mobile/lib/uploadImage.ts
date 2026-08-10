import { decode } from 'base64-arraybuffer';
// Expo SDK 57: readAsStringAsync / EncodingType yalnız legacy API-də mövcuddur.
import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from './supabase';

export type ImageVariantUrls = {
  /** Sıxılmış original (max ~1600px) */
  original: string;
  /** Detal qalereya (~800px) */
  medium: string;
  /** Kart/siyahı (~150px) */
  thumb: string;
};

async function uploadFile(
  uri: string,
  bucket: string,
  path: string,
  contentType = 'image/jpeg'
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    throw new Error('Şəkil yükləmək üçün daxil olun.');
  }
  const normalized = path.replace(/^\/+/, '');
  if (
    normalized.includes('..') ||
    normalized.startsWith('/') ||
    !normalized.startsWith(`${user.id}/`)
  ) {
    throw new Error('Şəkil yolu etibarsızdır.');
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const { error } = await supabase.storage.from(bucket).upload(normalized, decode(base64), {
    contentType,
    upsert: true,
  });
  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(normalized);
  return data.publicUrl;
}

/**
 * Lazy-load native manipulator — köhnə dev-client-də top-level import app-i çökdürür.
 */
async function resizeToJpeg(
  uri: string,
  width: number,
  compress: number
): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ImageManipulator = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width } }],
      {
        compress,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
    return result.uri;
  } catch {
    return null;
  }
}

/** Tək fayl yüklə (avatar və s.). */
export async function uploadImage(
  uri: string,
  bucket: string,
  path: string
): Promise<string> {
  const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
  return uploadFile(uri, bucket, path, mimeType);
}

/**
 * thumb / medium / original variantları yaradıb Storage-ə yükləyir.
 * `basePath` uzantısız olmalıdır, məs: `userId/poiId-0`
 *
 * Native modul yoxdursa eyni URL hər üç sahəyə yazılır (app işləməyə davam edir).
 * Tam variantlar üçün yeni native build lazımdır.
 */
export async function uploadImageVariants(
  uri: string,
  bucket: string,
  basePath: string
): Promise<ImageVariantUrls> {
  const originalUri = (await resizeToJpeg(uri, 1600, 0.72)) ?? uri;
  const mediumUri = (await resizeToJpeg(uri, 800, 0.7)) ?? originalUri;
  const thumbUri = (await resizeToJpeg(uri, 150, 0.65)) ?? mediumUri;

  // Manipulator yoxdursa bir dəfə yüklə, üç URL eyni olsun
  if (originalUri === uri && mediumUri === uri && thumbUri === uri) {
    const url = await uploadFile(uri, bucket, `${basePath}.jpg`);
    return { original: url, medium: url, thumb: url };
  }

  const [original, medium, thumb] = await Promise.all([
    uploadFile(originalUri, bucket, `${basePath}.jpg`),
    uploadFile(mediumUri, bucket, `${basePath}_m.jpg`),
    uploadFile(thumbUri, bucket, `${basePath}_t.jpg`),
  ]);

  return { original, medium, thumb };
}
