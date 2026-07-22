/** Plan AI route via FastAPI (geo order on server). Edge function = fallback only. */

import { supabase } from './supabase';

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
};

function getApiBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!raw) {
    return null;
  }
  return raw.replace(/\/+$/, '');
}

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

async function planRouteViaEdge(
  input: PlanRouteInput
): Promise<PlanRouteResult> {
  const response = await supabase.functions.invoke('plan-route', {
    body: {
      region: input.region,
      days: input.days,
      budget: input.budget,
      interests: input.interests,
      groupType: input.groupType ?? 'solo',
      weather: input.weather ?? null,
      pois: input.pois,
    },
  });

  if (response.error) {
    throw response.error;
  }

  let planData: any = response.data;
  if (typeof planData === 'string') {
    let cleaned = planData.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    }
    planData = JSON.parse(cleaned);
  }

  if (planData?.error) {
    throw new Error(String(planData.error));
  }

  if (!planData?.days || !Array.isArray(planData.days)) {
    throw new Error('Marşrut düzgün formada gəlmədi. Yenidən cəhd edin.');
  }

  return {
    summary: planData.summary ?? 'Marşrut hazırlandı.',
    days: planData.days.map((day: PlanRouteDay) => ({
      ...day,
      stops: Array.isArray(day.stops)
        ? day.stops
        : Array.isArray((day as { pois?: PlanRouteStop[] }).pois)
          ? (day as { pois: PlanRouteStop[] }).pois
          : [],
    })),
    total_cost: planData.total_cost,
    best_time: planData.best_time,
    source: 'edge_fallback',
  };
}

/** Prefer FastAPI geo planner; fall back to Edge Function if API unreachable. */
export async function planRoute(input: PlanRouteInput): Promise<PlanRouteResult> {
  const fromApi = await planRouteViaFastApi(input);
  if (fromApi) {
    return fromApi;
  }
  return planRouteViaEdge(input);
}
