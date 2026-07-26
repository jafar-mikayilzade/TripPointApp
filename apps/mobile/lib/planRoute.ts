/**
 * Plan AI route via FastAPI only (single source of truth).
 * Edge Function algorithm is deprecated — no second planner.
 * See docs/ARCHITECTURE.md → "AI marşrut (plan-route)".
 */

import { getApiBaseUrl } from './apiBase';
import { trackEvent } from './trackEvent';

export type PlanRouteStop = {
  poi_id?: string;
  id?: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  time?: string;
  duration?: string;
  duration_minutes?: number;
  tip?: string;
  daypart?: string;
};

export type PlanRouteDay = {
  day: number;
  title: string;
  stops: PlanRouteStop[];
  estimated_cost?: string;
  notes?: string;
};

export type PlanRouteResult = {
  summary: string;
  days: PlanRouteDay[];
  total_cost?: string;
  best_time?: string;
  region?: string;
  regionLabel?: string;
  source?: string;
  travel?: {
    from_origin?: boolean;
    outbound_minutes?: number;
    return_minutes?: number;
    depart_origin_at?: string;
    arrive_region_at?: string;
    leave_region_by?: string;
    return_origin_by?: string;
    distance_km?: number;
  } | null;
  lodging?: {
    id?: string;
    name?: string;
    category?: string;
    lat?: number;
    lng?: number;
    note?: string;
  } | null;
};

export type PlanRouteWeather = {
  prefer_indoor: boolean;
  summary_az?: string;
  exclude_categories?: string[];
  prefer_categories?: string[];
};

export type PlanRoutePois = {
  restaurants: unknown[];
  accommodations: unknown[];
  attractions: unknown[];
};

export type PlanRouteInput = {
  region: string;
  days: number;
  budget: string;
  interests: string[];
  groupType?: string;
  weather?: PlanRouteWeather | null;
  pois?: PlanRoutePois;
  fromOrigin?: boolean;
  originLat?: number | null;
  originLng?: number | null;
  departTime?: string;
  returnByTime?: string;
  /** Changes on each "plan again" so near-tied stops vary */
  varietySeed?: number;
  /** Soft-exclude POIs from the previous plan */
  excludePoiIds?: string[];
};

async function planRouteViaFastApi(
  input: PlanRouteInput
): Promise<PlanRouteResult | null> {
  const base = getApiBaseUrl();
  if (!base) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch(`${base}/api/plan-route`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        region: input.region,
        days: input.days,
        budget: input.budget,
        interests: input.interests,
        groupType: input.groupType ?? 'solo',
        weather: input.weather ?? null,
        pois: input.pois ?? null,
        fromOrigin: Boolean(input.fromOrigin),
        originLat: input.originLat ?? null,
        originLng: input.originLng ?? null,
        departTime: input.departTime ?? '08:00',
        returnByTime: input.returnByTime ?? '21:00',
        varietySeed: input.varietySeed ?? Date.now(),
        excludePoiIds: input.excludePoiIds ?? [],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = (await res.json()) as PlanRouteResult & {
      success?: boolean;
      error?: string;
      detail?: { error?: string } | string;
    };

    if (!res.ok) {
      const detail =
        typeof data.detail === 'object' && data.detail?.error
          ? data.detail.error
          : typeof data.detail === 'string'
            ? data.detail
            : data.error;
      // Business errors: do not fall back to Edge
      if (res.status >= 400 && res.status < 500) {
        throw new Error(detail || `Plan API xətası (${res.status})`);
      }
      return null;
    }

    if (!data?.days || !Array.isArray(data.days)) {
      return null;
    }

    return {
      summary: data.summary ?? 'Marşrut hazırlandı.',
      days: data.days.map((day) => ({
        ...day,
        stops: Array.isArray(day.stops) ? day.stops : [],
      })),
      total_cost: data.total_cost,
      best_time: data.best_time,
      region: data.region,
      regionLabel: data.regionLabel,
      travel: (data as PlanRouteResult).travel ?? null,
      lodging: (data as PlanRouteResult).lodging ?? null,
      source: data.source ?? 'fastapi_geo',
    };
  } catch (err) {
    if (err instanceof Error) {
      // Propagate 4xx business errors
      if (
        err.message.includes('yer tapılmadı') ||
        err.message.includes('kifayət') ||
        err.message.includes('Invalid region') ||
        err.message.includes('Plan API xətası (4')
      ) {
        throw err;
      }
    }
    return null;
  }
}

/** FastAPI geo planner only — retry once on network/5xx; no Edge algorithm. */
export async function planRoute(input: PlanRouteInput): Promise<PlanRouteResult> {
  const first = await planRouteViaFastApi(input);
  if (first) {
    void trackEvent('plan_route_success', {
      region: input.region,
      days: input.days,
      source: first.source ?? 'fastapi',
    });
    return first;
  }
  // Brief retry for transient Railway/network blips
  await new Promise((r) => setTimeout(r, 600));
  const second = await planRouteViaFastApi(input);
  if (second) {
    void trackEvent('plan_route_success', {
      region: input.region,
      days: input.days,
      source: second.source ?? 'fastapi_retry',
    });
    return second;
  }
  throw new Error(
    'Marşrut serveri əlçatan deyil. İnterneti yoxlayın və yenidən cəhd edin.'
  );
}
