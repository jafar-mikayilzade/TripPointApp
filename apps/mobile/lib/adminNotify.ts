import { getApiBaseUrl } from './apiBase';

export type AdminNotifyKind = 'poi_pending' | 'photo_pending' | 'listing_report';

const TELEGRAM_NOTIFY_TIMEOUT_MS = 6000;

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
 * Admin bildirişi — yalnız Telegram (şikayət / POI / şəkil təsdiqi).
 */
export async function notifyAdmins(
  kind: AdminNotifyKind,
  summary: string
): Promise<{ sent: boolean; error: string | null }> {
  const message = buildMessage(kind, summary);
  const base = getApiBaseUrl();
  if (!base) {
    if (__DEV__) {
      console.warn('[adminNotify] EXPO_PUBLIC_API_URL missing — skip Telegram');
    }
    return { sent: false, error: 'API URL yoxdur' };
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
      return { sent: false, error: `HTTP ${res.status}` };
    }
    const json = (await res.json().catch(() => null)) as { sent?: boolean } | null;
    return { sent: Boolean(json?.sent), error: null };
  } catch (err) {
    if (__DEV__) {
      console.warn('[adminNotify] Telegram failed', err);
    }
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'Telegram göndərilmədi',
    };
  } finally {
    clearTimeout(timer);
  }
}
