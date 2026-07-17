import { Linking } from 'react-native';

import { supabase } from './supabase';

export type AdminNotifyKind = 'poi_pending' | 'photo_pending' | 'listing_report';

/** Admin profil telefonlarını gətirir (E.164). */
export async function fetchAdminPhones(): Promise<string[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('phone')
    .eq('role', 'admin');

  if (error || !data) {
    return [];
  }

  const phones = data
    .map((row) => row.phone?.replace(/[^\d+]/g, '') ?? '')
    .map((phone) => phone.replace(/[^\d]/g, ''))
    .filter((phone) => phone.length >= 10);

  return [...new Set(phones)];
}

function buildMessage(kind: AdminNotifyKind, summary: string): string {
  const prefix =
    kind === 'poi_pending'
      ? 'TripPoint: yeni məkan təsdiqi gözləyir'
      : kind === 'photo_pending'
        ? 'TripPoint: yeni şəkil təsdiqi gözləyir'
        : 'TripPoint: elan şikayəti';

  return `${prefix}. ${summary}`.trim();
}

/**
 * Admin nömrəsinə qısa WhatsApp mesajı açır — istifadəçi özü göndərir.
 */
export async function notifyAdminsViaWhatsApp(
  kind: AdminNotifyKind,
  summary: string
): Promise<{ opened: boolean; error: string | null }> {
  try {
    const phones = await fetchAdminPhones();
    const text = encodeURIComponent(buildMessage(kind, summary));

    if (phones.length === 0) {
      await Linking.openURL(`https://wa.me/?text=${text}`);
      return { opened: true, error: null };
    }

    await Linking.openURL(`https://wa.me/${phones[0]}?text=${text}`);
    return { opened: true, error: null };
  } catch (err) {
    return {
      opened: false,
      error: err instanceof Error ? err.message : 'WhatsApp açıla bilmədi',
    };
  }
}
