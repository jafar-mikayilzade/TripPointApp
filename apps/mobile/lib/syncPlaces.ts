/** Background Places sync via FastAPI worker. Read path stays on Supabase. */

/** Mobile/DB PoiCategory + region-wide "all" */
const APP_CATEGORIES = [
  'restaurant',
  // cafe ignored for now (noisy / low tourism value)
  'hostel',
  'hotel',
  'home_restaurant',
  'guesthouse',
  'nature',
  'waterfall',
  'mountain',
  'lake',
  'historical',
  'monument',
  'other',
] as const;

type AppCategory = (typeof APP_CATEGORIES)[number];
type SyncCategory = AppCategory | 'all';

/** Mobile REGIONS.id → API REGION_COORDINATES key */
const REGION_TO_API: Record<string, string> = {
  quba: 'quba',
  qusar: 'qusar',
  seki: 'seki',
  qabala: 'qabala',
  lerik: 'lerik',
};

const DEBOUNCE_MS = 1200;
const COOLDOWN_MS = 90_000;
const BUSY_COOLDOWN_MS = 25_000;
const FETCH_TIMEOUT_MS = 55_000;
const FETCH_TIMEOUT_ALL_MS = 180_000;
const BUSY_RETRY_MS = 8_000;

const lastSyncedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<SyncPlacesResult>>();

/** Serialize all sync HTTP calls — API allows only one sync at a time (429 otherwise). */
let syncChain: Promise<void> = Promise.resolve();

function enqueueSync<T>(fn: () => Promise<T>): Promise<T> {
  const run = syncChain.then(fn, fn);
  syncChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export type SyncPlacesResult = {
  ok: boolean;
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

/** Pass real app category (or all) — API maps OSM tags → DB category. */
function mapCategoryToApi(categoryFilter: string | null | undefined): SyncCategory {
  if (!categoryFilter || categoryFilter === 'all') {
    return 'all';
  }
  if ((APP_CATEGORIES as readonly string[]).includes(categoryFilter)) {
    return categoryFilter as AppCategory;
  }
  return 'other';
}

function syncKey(apiRegion: string, apiCategory: SyncCategory): string {
  return `${apiRegion}:${apiCategory}`;
}

function isBusyResponse(
  status: number,
  body: { error?: string; message?: string } | null
): boolean {
  if (status === 429) {
    return true;
  }
  const err = `${body?.error ?? ''} ${body?.message ?? ''}`.toLowerCase();
  return err.includes('sync_busy') || err.includes('another sync');
}

type SyncOneStatus = 'synced' | 'skipped';

async function fetchSyncOnce(
  url: string,
  signal: AbortSignal
): Promise<{ response: Response; body: Record<string, unknown> | null }> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  return { response, body };
}

async function syncOne(
  baseUrl: string,
  apiRegion: string,
  apiCategory: SyncCategory
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

  const timeoutMs = apiCategory === 'all' ? FETCH_TIMEOUT_ALL_MS : FETCH_TIMEOUT_MS;

  const request = enqueueSync(async (): Promise<SyncPlacesResult> => {
    // Re-check cooldown after waiting in queue
    const queuedAt = Date.now();
    const lastAfterWait = lastSyncedAt.get(key) ?? 0;
    if (queuedAt - lastAfterWait < COOLDOWN_MS) {
      return { ok: true, attempted: false };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${baseUrl}/api/sync-places?region=${encodeURIComponent(apiRegion)}&category=${encodeURIComponent(apiCategory)}`;
    console.log('[syncPlaces] GET', url);

    try {
      let { response, body } = await fetchSyncOnce(url, controller.signal);

      if (
        isBusyResponse(response.status, body as { error?: string; message?: string } | null)
      ) {
        console.log('[syncPlaces] server busy — retry once');
        await new Promise((r) => setTimeout(r, BUSY_RETRY_MS));
        if (controller.signal.aborted) {
          return { ok: true, attempted: false };
        }
        ({ response, body } = await fetchSyncOnce(url, controller.signal));
      }

      if (
        isBusyResponse(response.status, body as { error?: string; message?: string } | null)
      ) {
        // Still busy — silent skip, short cooldown so we don't stampede
        lastSyncedAt.set(key, Date.now() - COOLDOWN_MS + BUSY_COOLDOWN_MS);
        console.log('[syncPlaces] still busy — skip');
        return { ok: true, attempted: false };
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
  });

  inFlight.set(key, request);
  try {
    const result = await request;
    return result.attempted ? 'synced' : 'skipped';
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
