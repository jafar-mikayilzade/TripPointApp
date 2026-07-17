import { decode } from 'base64-arraybuffer';
// Expo SDK 57: readAsStringAsync / EncodingType yalnız legacy API-də mövcuddur.
import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from './supabase';

export async function uploadImage(
  uri: string,
  bucket: string,
  path: string
): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

  const { error } = await supabase.storage.from(bucket).upload(path, decode(base64), {
    contentType: mimeType,
    upsert: true,
  });
  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
