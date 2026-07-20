import type { Listing, PoiStatus } from '../types/database';
import { getErrorMessage } from './errors';
import { fetchIsAdmin } from './adminMap';
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
    const { error } = await supabase.from('poi_photos').update({ status }).eq('id', photoId);
    if (error) {
      return { error: getErrorMessage(error) };
    }
    return { error: null };
  } catch (err) {
    return { error: getErrorMessage(err) };
  }
}

export async function reportListing(args: {
  listingId: string;
  reason: ListingReportReasonId;
  details?: string;
}): Promise<Result> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Daxil olmaq lazımdır' };
    }

    const reasonLabel =
      LISTING_REPORT_REASONS.find((item) => item.id === args.reason)?.label ?? args.reason;

    const { error } = await supabase.from('listing_reports').insert({
      listing_id: args.listingId,
      reporter_id: user.id,
      reason: reasonLabel,
      details: args.details?.trim() || null,
      status: 'open',
    });

    if (error) {
      if (error.code === '23505' || error.message?.includes('unique')) {
        return { error: 'Bu elanı artıq şikayət etmisiniz' };
      }
      return { error: getErrorMessage(error) };
    }
    return { error: null };
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

    const { error } = await supabase.rpc('cancel_listing', {
      p_listing_id: listingId,
    });

    if (!error) {
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
