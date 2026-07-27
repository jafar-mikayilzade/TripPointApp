import { getApiBaseUrl } from './apiBase';
import { getAuthHeaders } from './authHeaders';
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

/** One query for list screens — avoids N× isSubscribed per card. */
export async function listMySubscriptionTargetIds(): Promise<{
  listingIds: Set<string>;
  organizerIds: Set<string>;
  error?: string;
}> {
  const empty = { listingIds: new Set<string>(), organizerIds: new Set<string>() };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return empty;
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .select('target_type, target_id')
    .eq('user_id', user.id)
    .limit(200);

  if (error) {
    return { ...empty, error: error.message };
  }

  const listingIds = new Set<string>();
  const organizerIds = new Set<string>();
  for (const row of data ?? []) {
    if (row.target_type === 'listing') {
      listingIds.add(row.target_id);
    } else if (row.target_type === 'organizer') {
      organizerIds.add(row.target_id);
    }
  }
  return { listingIds, organizerIds };
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

/**
 * Fire-and-forget push + Telegram mirror.
 *
 * Only the row ids are sent — the server re-reads the rows and derives the
 * recipients and text itself, so nothing here can be forged client-side.
 */
async function mirrorNotifications(notificationIds: string[]): Promise<void> {
  const base = getApiBaseUrl();
  if (!base || notificationIds.length === 0) {
    return;
  }
  const headers = await getAuthHeaders();
  if (!headers) {
    return;
  }
  try {
    await fetch(`${base}/api/notify/dispatch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ notification_ids: notificationIds }),
    });
  } catch {
    // optional channel
  }
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

  const { data: inserted } = await supabase
    .from('notifications')
    .insert(rows)
    .select('id');

  const ids = (inserted ?? []).map((row) => row.id).filter(Boolean);
  void mirrorNotifications(ids);
}

/** Yeni tur yaradılanda — təşkilatçı abunələrinə bildiriş */
export async function notifyOrganizerNewTour(input: {
  organizerId: string;
  listingId: string;
  title: string;
  region?: string | null;
}): Promise<void> {
  // Spam guard: eyni listing üçün bir dəfə (own app_events — RLS-safe)
  const { data: prior } = await supabase
    .from('app_events')
    .select('id, props')
    .eq('user_id', input.organizerId)
    .eq('name', 'notify_organizer_sent')
    .limit(40);
  const already = (prior ?? []).some((row) => {
    const props = row.props as { listingId?: string } | null;
    return props?.listingId === input.listingId;
  });
  if (already) {
    return;
  }

  const { data } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('target_type', 'organizer')
    .eq('target_id', input.organizerId);

  const userIds = new Set(
    (data ?? [])
      .map((r) => r.user_id)
      .filter((id) => id !== input.organizerId)
  );

  // Region fans: users subscribed to other active listings in the same region
  const region = input.region?.trim().toLowerCase();
  if (region) {
    const { data: regionListings } = await supabase
      .from('listings')
      .select('id')
      .ilike('region', region)
      .eq('status', 'active')
      .neq('id', input.listingId)
      .limit(40);
    const listingIds = (regionListings ?? []).map((r) => r.id);
    if (listingIds.length > 0) {
      const { data: regionSubs } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('target_type', 'listing')
        .in('target_id', listingIds)
        .limit(200);
      for (const row of regionSubs ?? []) {
        if (row.user_id && row.user_id !== input.organizerId) {
          userIds.add(row.user_id);
        }
      }
    }
  }

  await insertNotificationsForUsers({
    userIds: [...userIds],
    kind: 'organizer_new_tour',
    title: 'Yeni tur',
    body: `${input.title} — izlədiyiniz təşkilatçı / regionda yeni elan.`,
    listingId: input.listingId,
    actorId: input.organizerId,
  });

  await supabase.from('app_events').insert({
    user_id: input.organizerId,
    name: 'notify_organizer_sent',
    props: { listingId: input.listingId },
  });
}

/** İştirakçı statusu dəyişəndə — yalnız həmin istifadəçiyə */
export async function notifyParticipantStatus(input: {
  userId: string;
  listingId: string;
  listingTitle: string;
  approved: boolean;
  actorId: string;
}): Promise<void> {
  if (!input.userId || input.userId === input.actorId) {
    return;
  }
  await insertNotificationsForUsers({
    userIds: [input.userId],
    kind: 'tour_update',
    title: input.approved ? 'Müraciət təsdiqləndi' : 'Müraciət rədd edildi',
    body: input.approved
      ? `"${input.listingTitle}" elanına qoşulmanız təsdiqləndi.`
      : `"${input.listingTitle}" elanına müraciətiniz rədd edildi.`,
    listingId: input.listingId,
    actorId: input.actorId,
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

/** Tur ləğv ediləndə — listing abunələrinə bildiriş */
export async function notifyTourSubscribersCancelled(input: {
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
    kind: 'tour_cancelled',
    title: 'Tur ləğv edildi',
    body: `${input.title} elanı ləğv olunub.`,
    listingId: input.listingId,
    actorId: input.actorId,
  });
}

export async function listMyNotifications(
  limit = 40
): Promise<{ data: AppNotification[]; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { data: [] };
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { data: [], error: error.message };
  }

  return {
    data: (data ?? []).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      listing_id: row.listing_id,
      actor_id: row.actor_id,
      read_at: row.read_at,
      created_at: row.created_at,
    })),
  };
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

export type ListingSubscriberRow = {
  id: string;
  user_id: string;
  created_at: string;
  full_name: string | null;
  avatar_url: string | null;
};

/** Listing owner: who subscribed to this tour. Requires owner SELECT RLS. */
export async function listListingSubscribers(
  listingId: string
): Promise<{ data: ListingSubscriberRow[]; error?: string }> {
  const { data: rows, error } = await supabase
    .from('subscriptions')
    .select('id, user_id, created_at')
    .eq('target_type', 'listing')
    .eq('target_id', listingId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return { data: [], error: error.message };
  }
  if (!rows?.length) {
    return { data: [] };
  }

  const userIds = rows.map((r) => r.user_id);
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', userIds);

  if (profilesError) {
    return { data: [], error: profilesError.message };
  }

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p] as const)
  );

  return {
    data: rows.map((row) => {
      const profile = profileMap.get(row.user_id);
      return {
        id: row.id,
        user_id: row.user_id,
        created_at: row.created_at,
        full_name: profile?.full_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
      };
    }),
  };
}

/** User's active subscriptions — tours + organizers they follow. */
export async function listMySubscriptions(): Promise<{
  data: MySubscriptionRow[];
  error?: string;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { data: [] };
  }

  const { data: rows, error } = await supabase
    .from('subscriptions')
    .select('id, target_type, target_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(80);

  if (error) {
    return { data: [], error: error.message };
  }
  if (!rows?.length) {
    return { data: [] };
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

  return {
    data: rows.map((row) => {
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
    }),
  };
}
