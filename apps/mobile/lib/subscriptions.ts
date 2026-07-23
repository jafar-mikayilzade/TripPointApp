import { supabase } from './supabase';

export type SubscriptionTargetType = 'listing' | 'organizer';

export type AppNotificationKind =
  | 'tour_update'
  | 'organizer_new_tour'
  | 'tour_cancelled';

export type AppNotification = {
  id: string;
  user_id: string;
  kind: AppNotificationKind;
  title: string;
  body: string | null;
  listing_id: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
};

export async function isSubscribed(
  targetType: SubscriptionTargetType,
  targetId: string
): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return false;
  }

  const { data } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', user.id)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .maybeSingle();

  return !!data;
}

export async function toggleSubscription(
  targetType: SubscriptionTargetType,
  targetId: string
): Promise<{ subscribed: boolean; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { subscribed: false, error: 'Giriş lazımdır' };
  }

  // Özünə abunə olmaq olmaz
  if (targetType === 'organizer' && targetId === user.id) {
    return { subscribed: false, error: 'Öz profilinizə abunə ola bilməzsiniz' };
  }

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', user.id)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase.from('subscriptions').delete().eq('id', existing.id);
    if (error) {
      return { subscribed: true, error: error.message };
    }
    return { subscribed: false };
  }

  const { error } = await supabase.from('subscriptions').insert({
    user_id: user.id,
    target_type: targetType,
    target_id: targetId,
  });

  if (error) {
    return { subscribed: false, error: error.message };
  }
  return { subscribed: true };
}

async function insertNotificationsForUsers(input: {
  userIds: string[];
  kind: AppNotificationKind;
  title: string;
  body?: string | null;
  listingId?: string | null;
  actorId?: string | null;
}): Promise<void> {
  const unique = [...new Set(input.userIds)].filter(Boolean);
  if (unique.length === 0) {
    return;
  }

  const rows = unique.map((userId) => ({
    user_id: userId,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    listing_id: input.listingId ?? null,
    actor_id: input.actorId ?? null,
  }));

  await supabase.from('notifications').insert(rows);
}

/** Yeni tur yaradılanda — təşkilatçı abunələrinə bildiriş */
export async function notifyOrganizerNewTour(input: {
  organizerId: string;
  listingId: string;
  title: string;
}): Promise<void> {
  const { data } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('target_type', 'organizer')
    .eq('target_id', input.organizerId);

  const userIds = (data ?? [])
    .map((r) => r.user_id)
    .filter((id) => id !== input.organizerId);

  await insertNotificationsForUsers({
    userIds,
    kind: 'organizer_new_tour',
    title: 'Yeni tur',
    body: `${input.title} — izlədiyiniz təşkilatçı yeni tur paylaşıb.`,
    listingId: input.listingId,
    actorId: input.organizerId,
  });
}

/** Tur yenilənəndə — həmin tura abunələrə bildiriş */
export async function notifyTourSubscribersUpdate(input: {
  listingId: string;
  title: string;
  actorId: string;
}): Promise<void> {
  const { data } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('target_type', 'listing')
    .eq('target_id', input.listingId);

  const userIds = (data ?? [])
    .map((r) => r.user_id)
    .filter((id) => id !== input.actorId);

  await insertNotificationsForUsers({
    userIds,
    kind: 'tour_update',
    title: 'Tur yeniləndi',
    body: `${input.title} elanında dəyişiklik var.`,
    listingId: input.listingId,
    actorId: input.actorId,
  });
}

export async function listMyNotifications(limit = 40): Promise<AppNotification[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    listing_id: row.listing_id,
    actor_id: row.actor_id,
    read_at: row.read_at,
    created_at: row.created_at,
  }));
}

export async function markNotificationRead(id: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return;
  }
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id);
}

export type MySubscriptionRow = {
  id: string;
  target_type: SubscriptionTargetType;
  target_id: string;
  created_at: string;
  /** listing title or organizer name */
  title: string;
  subtitle: string | null;
  avatar_url?: string | null;
  listing?: {
    id: string;
    title: string;
    type: string;
    region: string | null;
    status: string;
  } | null;
  organizer?: {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
  } | null;
};

/** User's active subscriptions — tours + organizers they follow. */
export async function listMySubscriptions(): Promise<MySubscriptionRow[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }

  const { data: rows, error } = await supabase
    .from('subscriptions')
    .select('id, target_type, target_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(80);

  if (error || !rows?.length) {
    return [];
  }

  const listingIds = rows
    .filter((r) => r.target_type === 'listing')
    .map((r) => r.target_id);
  const organizerIds = rows
    .filter((r) => r.target_type === 'organizer')
    .map((r) => r.target_id);

  const [listingsRes, organizersRes] = await Promise.all([
    listingIds.length
      ? supabase
          .from('listings')
          .select('id, title, type, region, status')
          .in('id', listingIds)
      : Promise.resolve({ data: [] as const, error: null }),
    organizerIds.length
      ? supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', organizerIds)
      : Promise.resolve({ data: [] as const, error: null }),
  ]);

  const listingMap = new Map(
    (listingsRes.data ?? []).map((l) => [l.id, l] as const)
  );
  const organizerMap = new Map(
    (organizersRes.data ?? []).map((o) => [o.id, o] as const)
  );

  return rows.map((row) => {
    if (row.target_type === 'listing') {
      const listing = listingMap.get(row.target_id) ?? null;
      return {
        id: row.id,
        target_type: 'listing' as const,
        target_id: row.target_id,
        created_at: row.created_at,
        title: listing?.title || 'Tur',
        subtitle: listing
          ? `${listing.type === 'tour' ? 'Tur' : listing.type} abunəliyi`
          : 'Tur abunəliyi',
        listing,
        organizer: null,
      };
    }
    const organizer = organizerMap.get(row.target_id) ?? null;
    return {
      id: row.id,
      target_type: 'organizer' as const,
      target_id: row.target_id,
      created_at: row.created_at,
      title: organizer?.full_name?.trim() || 'Təşkilatçı',
      subtitle: 'Təşkilatçı abunəliyi',
      avatar_url: organizer?.avatar_url ?? null,
      listing: null,
      organizer,
    };
  });
}
