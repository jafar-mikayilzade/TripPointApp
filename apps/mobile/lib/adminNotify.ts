import { Linking } from 'react-native';

import { getApiBaseUrl } from './apiBase';
import { supabase } from './supabase';

export type AdminNotifyKind = 'poi_pending' | 'photo_pending' | 'listing_report';

const TELEGRAM_NOTIFY_TIMEOUT_MS = 6000;

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
 * Telegram admin notify via FastAPI.
 * Awaited before WhatsApp so the request is not aborted when the app backgrounds.
 */
async function notifyAdminsViaTelegram(message: string): Promise<boolean> {
  const base = getApiBaseUrl();
  if (!base) {
    if (__DEV__) {
      console.warn('[adminNotify] EXPO_PUBLIC_API_URL missing — skip Telegram');
    }
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_NOTIFY_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}/api/telegram/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
      signal: controller.signal,
    });
    if (!res.ok) {
      if (__DEV__) {
        console.warn('[adminNotify] Telegram HTTP', res.status);
      }
      return false;
    }
    const json = (await res.json().catch(() => null)) as { sent?: boolean } | null;
    return Boolean(json?.sent);
  } catch (err) {
    if (__DEV__) {
      console.warn('[adminNotify] Telegram failed', err);
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adminə əvvəl Telegram (API), sonra WhatsApp (istifadəçi göndərir).
 */
export async function notifyAdminsViaWhatsApp(
  kind: AdminNotifyKind,
  summary: string
): Promise<{ opened: boolean; error: string | null; telegramSent: boolean }> {
  const message = buildMessage(kind, summary);
  // Must finish before Linking.openURL — otherwise RN aborts the fetch on background
  const telegramSent = await notifyAdminsViaTelegram(message);

  try {
    const phones = await fetchAdminPhones();
    const text = encodeURIComponent(message);

    if (phones.length === 0) {
      await Linking.openURL(`https://wa.me/?text=${text}`);
      return { opened: true, error: null, telegramSent };
    }

    await Linking.openURL(`https://wa.me/${phones[0]}?text=${text}`);
    return { opened: true, error: null, telegramSent };
  } catch (err) {
    return {
      opened: false,
      error: err instanceof Error ? err.message : 'WhatsApp açıla bilmədi',
      telegramSent,
    };
  }
}
