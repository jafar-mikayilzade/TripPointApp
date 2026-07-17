/** Background Places sync via FastAPI worker. Read path stays on Supabase. */

const API_CATEGORIES = ['restaurant', 'hotel', 'tourist_attraction'] as const;
type ApiCategory = (typeof API_CATEGORIES)[number];

/** Mobile REGIONS.id → API REGION_COORDINATES key (API indi mobile id-ləri də qəbul edir) */
const REGION_TO_API: Record<string, string> = {
  quba: 'quba',
  qusar: 'qusar',
  seki: 'seki',
  qabala: 'qabala',
  lerik: 'lerik',
};

const DEBOUNCE_MS = 1200;
/** Eyni region+category üçün təkrar sync spam-ini kəs */
const COOLDOWN_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 55_000;

const lastSyncedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<SyncPlacesResult>>();

export type SyncPlacesResult = {
  ok: boolean;
  /** True when something was attempted (not skipped by cooldown / missing config). */
  attempted: boolean;
  error?: string;
};

function getApiBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!raw) {
    return null;
  }
  return raw.replace(/\/+$/, '');
}

/**
 * Yalnız BİR API kateqoriyası — "all" üçün 3 Overpass sync UI-ni dondururdu.
 * Hamısı seçiləndə ən faydalı olan restaurant sync olunur.
 */
function mapCategoryToApi(categoryFilter: string | null | undefined): ApiCategory {
  if (!categoryFilter || categoryFilter === 'all') {
    return 'restaurant';
  }

  if (['restaurant', 'cafe', 'home_restaurant'].includes(categoryFilter)) {
    return 'restaurant';
  }

  if (['hotel', 'hostel', 'guesthouse'].includes(categoryFilter)) {
    return 'hotel';
  }

  return 'tourist_attraction';
}

function syncKey(apiRegion: string, apiCategory: ApiCategory): string {
  return `${apiRegion}:${apiCategory}`;
}

type SyncOneStatus = 'synced' | 'skipped';

async function syncOne(
  baseUrl: string,
  apiRegion: string,
  apiCategory: ApiCategory
): Promise<SyncOneStatus> {
  const key = syncKey(apiRegion, apiCategory);
  const now = Date.now();
  const last = lastSyncedAt.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return 'skipped';
  }

  const existing = inFlight.get(key);
  if (existing) {
    await existing;
    return 'synced';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const request = (async (): Promise<SyncPlacesResult> => {
    const url = `${baseUrl}/api/sync-places?region=${encodeURIComponent(apiRegion)}&category=${encodeURIComponent(apiCategory)}`;
    console.log('[syncPlaces] GET', url);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      let body: { success?: boolean; message?: string; detail?: unknown } | null = null;
      try {
        body = (await response.json()) as typeof body;
      } catch {
        body = null;
      }

      if (!response.ok || body?.success === false) {
        const detail =
          typeof body?.message === 'string'
            ? body.message
            : typeof body?.detail === 'string'
              ? body.detail
              : `HTTP ${response.status}`;
        throw new Error(detail);
      }

      lastSyncedAt.set(key, Date.now());
      return { ok: true, attempted: true };
    } finally {
      clearTimeout(timeout);
    }
  })();

  inFlight.set(key, request);
  try {
    await request;
    return 'synced';
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Syncs places for a mobile region + home category filter.
 * Never throws — callers should refresh Supabase after `ok`.
 */
export async function syncPlaces(
  regionId: string | null | undefined,
  categoryFilter: string | null | undefined
): Promise<SyncPlacesResult> {
  if (!regionId) {
    return { ok: false, attempted: false };
  }

  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    console.log('[syncPlaces] EXPO_PUBLIC_API_URL missing — skip');
    return { ok: false, attempted: false, error: 'API URL təyin edilməyib' };
  }

  const apiRegion = REGION_TO_API[regionId.toLowerCase()];
  if (!apiRegion) {
    console.log('[syncPlaces] region not mapped for API:', regionId);
    return { ok: false, attempted: false };
  }

  const apiCategory = mapCategoryToApi(categoryFilter);

  try {
    const status = await syncOne(baseUrl, apiRegion, apiCategory);
    if (status === 'synced') {
      return { ok: true, attempted: true };
    }
    return { ok: true, attempted: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log('[syncPlaces] failed:', apiCategory, message);
    return { ok: false, attempted: true, error: message };
  }
}

/** Debounced background sync; cancels previous pending call on re-invoke. */
export function createDebouncedSyncPlaces(
  onDone: (result: SyncPlacesResult) => void,
  delayMs = DEBOUNCE_MS
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  return {
    schedule(regionId: string | null, categoryFilter: string) {
      if (timer) {
        clearTimeout(timer);
      }
      const gen = ++generation;
      timer = setTimeout(() => {
        timer = null;
        void syncPlaces(regionId, categoryFilter).then((result) => {
          if (gen !== generation) {
            return;
          }
          onDone(result);
        });
      }, delayMs);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      generation += 1;
    },
  };
}
