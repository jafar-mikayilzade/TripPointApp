import { supabase } from './supabase';
import { isDatabasePoiId } from './livePlaces';
import { trackEvent } from './trackEvent';
import { upsertGooglePlace, type UpsertGooglePlaceInput } from './upsertGooglePlace';

export type FavoriteTargetType = 'poi' | 'listing';

export type LivePoiFavoriteSeed = UpsertGooglePlaceInput;

export async function isFavorited(
  targetType: FavoriteTargetType,
  targetId: string
): Promise<boolean> {
  if (targetType === 'poi' && !isDatabasePoiId(targetId)) {
    return false;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return false;
  }

  const { data, error } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', user.id)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .maybeSingle();

  if (error) {
    return false;
  }
  return !!data;
}

/**
 * Toggle favorite. For live Google POIs pass `liveSeed` — upserts to DB then favorites UUID.
 */
export async function toggleFavorite(
  targetType: FavoriteTargetType,
  targetId: string,
  liveSeed?: LivePoiFavoriteSeed | null
): Promise<{ favorited: boolean; resolvedId?: string; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { favorited: false, error: 'Giriş lazımdır' };
  }

  let resolvedId = targetId;

  if (targetType === 'poi' && !isDatabasePoiId(targetId)) {
    if (!liveSeed?.place_id || !liveSeed.name) {
      return {
        favorited: false,
        error: 'Canlı məkan üçün place_id / ad lazımdır.',
      };
    }
    try {
      const upserted = await upsertGooglePlace({
        ...liveSeed,
        place_id: liveSeed.place_id || targetId,
      });
      resolvedId = upserted.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Məkan yazılmadı';
      return { favorited: false, error: message };
    }
  }

  const { data: existing } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', user.id)
    .eq('target_type', targetType)
    .eq('target_id', resolvedId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase.from('favorites').delete().eq('id', existing.id);
    if (error) {
      return { favorited: true, resolvedId, error: error.message };
    }
    return { favorited: false, resolvedId };
  }

  const { error } = await supabase.from('favorites').insert({
    user_id: user.id,
    target_type: targetType,
    target_id: resolvedId,
  });

  if (error) {
    return { favorited: false, resolvedId, error: error.message };
  }
  void trackEvent('favorite_add', { targetType, targetId: resolvedId });
  return { favorited: true, resolvedId };
}

export async function listFavoriteIds(
  targetType: FavoriteTargetType
): Promise<Set<string>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Set();
  }

  const { data } = await supabase
    .from('favorites')
    .select('target_id')
    .eq('user_id', user.id)
    .eq('target_type', targetType);

  return new Set((data ?? []).map((row) => row.target_id));
}

/** İstifadəçinin sevimli listing id-ləri (yaradılma tarixinə görə). */
export async function listFavoriteListingIdsOrdered(): Promise<string[]> {
  return listFavoriteIdsOrdered('listing');
}

/** İstifadəçinin sevimli POI id-ləri. */
export async function listFavoritePoiIdsOrdered(): Promise<string[]> {
  return listFavoriteIdsOrdered('poi');
}

async function listFavoriteIdsOrdered(targetType: FavoriteTargetType): Promise<string[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from('favorites')
    .select('target_id, created_at')
    .eq('user_id', user.id)
    .eq('target_type', targetType)
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }
  return data.map((row) => row.target_id);
}
