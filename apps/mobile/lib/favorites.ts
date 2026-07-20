import { supabase } from './supabase';

export type FavoriteTargetType = 'poi' | 'listing';

export async function isFavorited(
  targetType: FavoriteTargetType,
  targetId: string
): Promise<boolean> {
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

export async function toggleFavorite(
  targetType: FavoriteTargetType,
  targetId: string
): Promise<{ favorited: boolean; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { favorited: false, error: 'Giriş lazımdır' };
  }

  const { data: existing } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', user.id)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase.from('favorites').delete().eq('id', existing.id);
    if (error) {
      return { favorited: true, error: error.message };
    }
    return { favorited: false };
  }

  const { error } = await supabase.from('favorites').insert({
    user_id: user.id,
    target_type: targetType,
    target_id: targetId,
  });

  if (error) {
    return { favorited: false, error: error.message };
  }
  return { favorited: true };
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
