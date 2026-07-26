import { decode } from 'base64-arraybuffer';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
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
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const { error } = await supabase.storage.from(bucket).upload(path, decode(base64), {
    contentType,
    upsert: true,
  });
  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function resizeToJpeg(
  uri: string,
  width: number,
  compress: number
): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress,
  });
  return saved.uri;
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
 * Qeyd: expo-image-manipulator native modul — production / yeni dev-client rebuild lazımdır.
 */
export async function uploadImageVariants(
  uri: string,
  bucket: string,
  basePath: string
): Promise<ImageVariantUrls> {
  const originalUri = await resizeToJpeg(uri, 1600, 0.72);
  const mediumUri = await resizeToJpeg(uri, 800, 0.7);
  const thumbUri = await resizeToJpeg(uri, 150, 0.65);

  const [original, medium, thumb] = await Promise.all([
    uploadFile(originalUri, bucket, `${basePath}.jpg`),
    uploadFile(mediumUri, bucket, `${basePath}_m.jpg`),
    uploadFile(thumbUri, bucket, `${basePath}_t.jpg`),
  ]);

  return { original, medium, thumb };
}
