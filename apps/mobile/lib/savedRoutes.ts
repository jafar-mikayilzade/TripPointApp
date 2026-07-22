import { supabase } from './supabase';

export type SavedRouteSource = 'manual' | 'ai';

export type SavedRouteStop = {
  day?: number;
  sort_order?: number;
  poi_id?: string | null;
  name: string;
  lat: number;
  lng: number;
  category?: string;
  source?: string;
  time?: string;
  duration?: string;
  tip?: string;
};

export type SavedRoute = {
  id: string;
  user_id: string;
  source: SavedRouteSource;
  title: string;
  summary: string | null;
  region: string | null;
  days_count: number;
  budget: string | null;
  interests: string[] | null;
  group_type: string | null;
  from_origin: boolean;
  origin_lat: number | null;
  origin_lng: number | null;
  total_cost: string | null;
  best_time: string | null;
  travel: Record<string, unknown> | null;
  stops: SavedRouteStop[];
  listing_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SaveRouteInput = {
  source: SavedRouteSource;
  title: string;
  summary?: string | null;
  region?: string | null;
  daysCount?: number;
  budget?: string | null;
  interests?: string[] | null;
  groupType?: string | null;
  fromOrigin?: boolean;
  originLat?: number | null;
  originLng?: number | null;
  totalCost?: string | null;
  bestTime?: string | null;
  travel?: Record<string, unknown> | null;
  stops: SavedRouteStop[];
};

function mapRow(row: Record<string, unknown>): SavedRoute {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    source: row.source as SavedRouteSource,
    title: String(row.title ?? 'Marşrut'),
    summary: (row.summary as string | null) ?? null,
    region: (row.region as string | null) ?? null,
    days_count: Number(row.days_count ?? 1),
    budget: (row.budget as string | null) ?? null,
    interests: (row.interests as string[] | null) ?? null,
    group_type: (row.group_type as string | null) ?? null,
    from_origin: Boolean(row.from_origin),
    origin_lat: row.origin_lat != null ? Number(row.origin_lat) : null,
    origin_lng: row.origin_lng != null ? Number(row.origin_lng) : null,
    total_cost: (row.total_cost as string | null) ?? null,
    best_time: (row.best_time as string | null) ?? null,
    travel: (row.travel as Record<string, unknown> | null) ?? null,
    stops: Array.isArray(row.stops) ? (row.stops as SavedRouteStop[]) : [],
    listing_id: row.listing_id != null ? String(row.listing_id) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

export async function saveRoute(
  input: SaveRouteInput
): Promise<{ id?: string; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Giriş lazımdır' };
  }

  if (!input.stops.length) {
    return { error: 'Marşrutda ən azı bir nöqtə olmalıdır' };
  }

  const title = input.title.trim() || 'Marşrut';
  const { data, error } = await supabase
    .from('saved_routes')
    .insert({
      user_id: user.id,
      source: input.source,
      title,
      summary: input.summary?.trim() || null,
      region: input.region ?? null,
      days_count: input.daysCount ?? 1,
      budget: input.budget ?? null,
      interests: input.interests ?? null,
      group_type: input.groupType ?? null,
      from_origin: Boolean(input.fromOrigin),
      origin_lat: input.originLat ?? null,
      origin_lng: input.originLng ?? null,
      total_cost: input.totalCost ?? null,
      best_time: input.bestTime ?? null,
      travel: input.travel ?? null,
      stops: input.stops,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  return { id: data?.id };
}

export async function listSavedRoutes(): Promise<SavedRoute[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from('saved_routes')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }
  return data.map((row) => mapRow(row as Record<string, unknown>));
}

export async function deleteSavedRoute(id: string): Promise<{ error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Giriş lazımdır' };
  }

  const { error } = await supabase
    .from('saved_routes')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    return { error: error.message };
  }
  return {};
}

export async function linkSavedRouteToListing(
  savedRouteId: string,
  listingId: string
): Promise<{ error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Giriş lazımdır' };
  }

  const { error } = await supabase
    .from('saved_routes')
    .update({
      listing_id: listingId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', savedRouteId)
    .eq('user_id', user.id);

  if (error) {
    if (/listing_id/i.test(error.message)) {
      return {};
    }
    return { error: error.message };
  }
  return {};
}
