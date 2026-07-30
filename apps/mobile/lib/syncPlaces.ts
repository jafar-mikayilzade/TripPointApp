/** Fire-and-forget OSM attractions → pois insert-if-missing (lazy region fill). */

import { getApiBaseUrl } from './apiBase';

const recentSyncAt = new Map<string, number>();
const SYNC_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Non-blocking: fills `pois` for a region from OSM attractions.
 * Existing place_ids are skipped server-side. Failures are silent.
 */
export function triggerRegionPlacesSync(region: string | null | undefined): void {
  const key = (region || '').trim().toLowerCase();
  if (!key) return;

  const base = getApiBaseUrl();
  if (!base) return;

  const now = Date.now();
  const last = recentSyncAt.get(key) ?? 0;
  if (now - last < SYNC_COOLDOWN_MS) return;
  recentSyncAt.set(key, now);

  const url =
    `${base}/api/sync-places?region=${encodeURIComponent(key)}` +
    `&category=all`;

  void (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        console.warn('[syncPlaces] skipped', key, res.status);
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        inserted?: number;
        skipped?: number;
      } | null;
      console.log(
        '[syncPlaces]',
        key,
        'inserted=',
        body?.inserted ?? '?',
        'skipped=',
        body?.skipped ?? '?'
      );
    } catch (err) {
      console.warn('[syncPlaces] fail', key, err);
    }
  })();
}
