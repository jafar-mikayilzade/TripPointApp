import { getApiBaseUrl } from './apiBase';

export type AdminNotifyKind = 'poi_pending' | 'photo_pending' | 'listing_report';

const TELEGRAM_NOTIFY_TIMEOUT_MS = 8000;

function buildMessage(kind: AdminNotifyKind, summary: string): string {
  const prefix =
    kind === 'poi_pending'
      ? '🛡 TripPoint · yeni məkan təsdiqi'
      : kind === 'photo_pending'
        ? '🛡 TripPoint · yeni şəkil təsdiqi'
        : '🛡 TripPoint · elan şikayəti';

  return `${prefix}\n${summary}`.trim();
}

/**
 * Admin bildirişi — bütün bağlı admin Telegram-lara + inline təsdiq/rədd.
 */
export async function notifyAdmins(
  kind: AdminNotifyKind,
  summary: string,
  targetId?: string | null
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
    const body: { text: string; kind: AdminNotifyKind; target_id?: string } = {
      text: message,
      kind,
    };
    if (targetId?.trim()) {
      body.target_id = targetId.trim();
    }

    const res = await fetch(`${base}/api/telegram/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      if (__DEV__) {
        console.warn('[adminNotify] Telegram HTTP', res.status);
      }
      return { sent: false, error: `HTTP ${res.status}` };
    }
    const json = (await res.json().catch(() => null)) as { sent?: number } | null;
    return { sent: (json?.sent ?? 0) > 0, error: null };
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
