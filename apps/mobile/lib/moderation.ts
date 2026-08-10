import type { Listing, PoiStatus } from '../types/database';
import { getApiBaseUrl } from './apiBase';
import { getAuthHeaders } from './authHeaders';
import { getErrorMessage } from './errors';
import { fetchIsAdmin } from './adminMap';
import { notifyTourSubscribersCancelled } from './subscriptions';
import { supabase } from './supabase';

type Result = { error: string | null };

export const LISTING_REPORT_REASONS = [
  { id: 'inappropriate', label: 'Uyğunsuz məzmun / davranış' },
  { id: 'unethical', label: 'Qeyri-etik ifadələr' },
  { id: 'scam', label: 'Aldatma / fırıldaq şübhəsi' },
  { id: 'spam', label: 'Spam / təkrar elan' },
  { id: 'other', label: 'Digər' },
] as const;

export type ListingReportReasonId = (typeof LISTING_REPORT_REASONS)[number]['id'];

export async function setPoiStatus(poiId: string, status: PoiStatus): Promise<Result> {
  try {
    const { error } = await supabase
      .from('pois')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', poiId);

    if (error) {
      return { error: getErrorMessage(error) };
    }
    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

export async function setPoiPhotoStatus(
  photoId: string,
  status: 'pending' | 'approved' | 'rejected'
): Promise<Result> {
  try {
    const base = getApiBaseUrl();
    const headers = await getAuthHeaders();
    if (base && headers) {
      try {
        const res = await fetch(`${base}/api/pois/photos/${photoId}/status`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status }),
        });
        if (res.ok) {
          return { error: null };
        }
      } catch {
        // fall through to direct update
      }
    }

    // Load URLs before status change so we can purge gallery fallbacks on reject
    let purgeUrls: string[] = [];
    let poiId: string | null = null;
    if (status === 'rejected') {
      const { data: row } = await supabase
        .from('poi_photos')
        .select('poi_id, photo_url, thumb_url, medium_url')
        .eq('id', photoId)
        .maybeSingle();
      if (row) {
        poiId = row.poi_id;
        purgeUrls = [row.photo_url, row.thumb_url, row.medium_url]
          .map((u) => (typeof u === 'string' ? u.trim() : ''))
          .filter(Boolean);
      }
    }

    const { error } = await supabase.from('poi_photos').update({ status }).eq('id', photoId);
    if (error) {
      return { error: getErrorMessage(error) };
    }

    if (status === 'rejected' && poiId && purgeUrls.length > 0) {
      await purgePoiGalleryUrls(poiId, purgeUrls);
    }

    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

export async function setPostPhotoStatus(
  photoId: string,
  status: 'pending' | 'approved' | 'rejected'
): Promise<Result> {
  try {
    const base = getApiBaseUrl();
    const headers = await getAuthHeaders();
    if (base && headers) {
      try {
        const res = await fetch(`${base}/api/posts/photos/${photoId}/status`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status }),
        });
        if (res.ok) {
          return { error: null };
        }
      } catch {
        // fall through
      }
    }

    const { error } = await supabase.from('post_photos').update({ status }).eq('id', photoId);
    if (error) {
      return { error: getErrorMessage(error) };
    }
    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

async function purgePoiGalleryUrls(poiId: string, urls: string[]): Promise<void> {
  const blocked = new Set(urls.map((u) => u.trim()).filter(Boolean));
  if (blocked.size === 0) {
    return;
  }
  const { data: poi } = await supabase
    .from('pois')
    .select('photo_urls, thumbnail_url')
    .eq('id', poiId)
    .maybeSingle();
  if (!poi) {
    return;
  }
  const patch: { photo_urls?: string[] | null; thumbnail_url?: string | null } = {};
  const raw = Array.isArray(poi.photo_urls) ? poi.photo_urls : [];
  const kept = raw
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => u && !blocked.has(u));
  if (kept.length !== raw.length) {
    patch.photo_urls = kept;
  }
  const thumb = typeof poi.thumbnail_url === 'string' ? poi.thumbnail_url.trim() : '';
  if (thumb && blocked.has(thumb)) {
    patch.thumbnail_url = kept[0] ?? null;
  }
  if (Object.keys(patch).length > 0) {
    await supabase.from('pois').update(patch).eq('id', poiId);
  }
}

export async function reportListing(args: {
  listingId: string;
  reason: ListingReportReasonId;
  details?: string;
}): Promise<Result & { reportId?: string }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Daxil olmaq lazımdır' };
    }

    const reasonLabel =
      LISTING_REPORT_REASONS.find((item) => item.id === args.reason)?.label ?? args.reason;

    const { data, error } = await supabase
      .from('listing_reports')
      .insert({
        listing_id: args.listingId,
        reporter_id: user.id,
        reason: reasonLabel,
        details: args.details?.trim() || null,
        status: 'open',
      })
      .select('id')
      .maybeSingle();

    if (error) {
      if (error.code === '23505' || error.message?.includes('unique')) {
        return { error: 'Bu elanı artıq şikayət etmisiniz' };
      }
      return { error: getErrorMessage(error) };
    }
    return { error: null, reportId: data?.id };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

/** Sahib və ya admin soft-delete (status = cancelled) via SECURITY DEFINER RPC. */
export async function deleteListingAsAdminOrOwner(listingId: string): Promise<Result> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Daxil olmaq lazımdır' };
    }

    const { data: listingMeta } = await supabase
      .from('listings')
      .select('title')
      .eq('id', listingId)
      .maybeSingle();
    const title = listingMeta?.title?.trim() || 'Tur';

    const { error } = await supabase.rpc('cancel_listing', {
      p_listing_id: listingId,
    });

    if (!error) {
      void notifyTourSubscribersCancelled({
        listingId,
        title,
        actorId: user.id,
      });
      return { error: null };
    }

    const missingRpc =
      error.message?.includes('Could not find the function') ||
      error.message?.includes('cancel_listing') ||
      error.code === 'PGRST202';

    if (!missingRpc) {
      return { error: getErrorMessage(error) };
    }

    // Fallback if RPC not deployed yet
    const admin = await fetchIsAdmin(user.id);
    let query = supabase
      .from('listings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', listingId);

    if (!admin) {
      query = query.eq('created_by', user.id);
    }

    const { data, error: updateError } = await query.select('id').maybeSingle();
    if (updateError) {
      return { error: getErrorMessage(updateError) };
    }
    if (!data) {
      return {
        error: 'Elan silinmədi. İcazə yoxdur və ya elan tapılmadı.',
      };
    }
    void notifyTourSubscribersCancelled({
      listingId,
      title,
      actorId: user.id,
    });
    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

export async function updateListingAsAdmin(
  listingId: string,
  patch: Partial<
    Pick<Listing, 'title' | 'description' | 'status' | 'price' | 'contact_phone' | 'spots_left'>
  >
): Promise<Result> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Daxil olmaq lazımdır' };
    }

    const admin = await fetchIsAdmin(user.id);
    if (!admin) {
      return { error: 'Yalnız admin redaktə edə bilər' };
    }

    const { error } = await supabase.rpc('admin_update_listing', {
      p_listing_id: listingId,
      p_title: patch.title ?? null,
      p_description: patch.description ?? null,
      p_status: patch.status ?? null,
      p_price: patch.price ?? null,
      p_contact_phone: patch.contact_phone ?? null,
      p_spots_left: patch.spots_left ?? null,
    });

    if (!error) {
      return { error: null };
    }

    const missingRpc =
      error.message?.includes('Could not find the function') ||
      error.message?.includes('admin_update_listing') ||
      error.code === 'PGRST202';

    if (!missingRpc) {
      return { error: getErrorMessage(error) };
    }

    const { data, error: updateError } = await supabase
      .from('listings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', listingId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      return { error: getErrorMessage(updateError) };
    }
    if (!data) {
      return { error: 'Elan yenilənmədi. İcazə yoxdur və ya elan tapılmadı.' };
    }

    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

export async function setListingReportStatus(
  reportId: string,
  status: 'open' | 'reviewed' | 'dismissed' | 'actioned'
): Promise<Result> {
  try {
    const { error } = await supabase
      .from('listing_reports')
      .update({ status })
      .eq('id', reportId);
    if (error) {
      return { error: getErrorMessage(error) };
    }
    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

export type AdminQueueCounts = {
  pois: number;
  photos: number;
  reports: number;
};

/** Admin profil / TG: gözləyən növbə sayları */
export async function fetchAdminQueueCounts(): Promise<AdminQueueCounts> {
  const base = getApiBaseUrl();
  const headers = await getAuthHeaders();

  let photosCount: number | null = null;

  if (base && headers) {
    try {
      const [poiPhotosRes, postPhotosRes] = await Promise.all([
        fetch(`${base}/api/pois/photos/pending`, { headers }),
        fetch(`${base}/api/posts/photos/pending`, { headers }),
      ]);
      let total = 0;
      let ok = false;
      if (poiPhotosRes.ok) {
        const json = (await poiPhotosRes.json()) as { count?: number };
        total += json.count ?? 0;
        ok = true;
      }
      if (postPhotosRes.ok) {
        const json = (await postPhotosRes.json()) as { count?: number };
        total += json.count ?? 0;
        ok = true;
      }
      if (ok) {
        photosCount = total;
      }
    } catch {
      // fall through
    }
  }

  const [poisRes, photosRes, reportsRes] = await Promise.all([
    supabase
      .from('pois')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    photosCount == null
      ? supabase
          .from('poi_photos')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
      : Promise.resolve({ count: photosCount, error: null }),
    supabase
      .from('listing_reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open'),
  ]);

  let photos = photosCount ?? photosRes.count ?? 0;
  if (photosCount == null) {
    const postCount = await supabase
      .from('post_photos')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (!postCount.error) {
      photos += postCount.count ?? 0;
    }
  }

  return {
    pois: poisRes.count ?? 0,
    photos,
    reports: reportsRes.count ?? 0,
  };
}

