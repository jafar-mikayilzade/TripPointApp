/** Cached regional weather from FastAPI — keeps OpenWeather key + quota off the client. */

import { getApiBaseUrl } from './apiBase';

export type WeatherAdvice = {
  ok: boolean;
  available?: boolean;
  region?: string;
  prefer_indoor: boolean;
  summary_az: string;
  /** UI: "18° · açıq hava" */
  display_az?: string;
  temp_c?: number | null;
  feels_like?: number | null;
  condition_az?: string;
  exclude_categories: string[];
  prefer_categories: string[];
  cached?: boolean;
  error?: string;
};

/** Qısa hava mətni — banner / chip üçün. */
export function formatWeatherLabel(weather: WeatherAdvice | null | undefined): string | null {
  if (!weather?.ok) {
    return null;
  }
  const display = weather.display_az?.trim();
  if (display) {
    return display;
  }
  if (typeof weather.temp_c === 'number' && weather.condition_az) {
    return `${Math.round(weather.temp_c)}° · ${weather.condition_az}`;
  }
  if (typeof weather.temp_c === 'number') {
    return `${Math.round(weather.temp_c)}°`;
  }
  const summary = weather.summary_az?.trim();
  return summary || null;
}

const MEMORY_TTL_MS = 10 * 60_000;
const memory = new Map<string, { at: number; data: WeatherAdvice }>();

export async function fetchRegionWeather(
  region: string,
  days: number
): Promise<WeatherAdvice | null> {
  const key = `${region.toLowerCase()}:${days}`;
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < MEMORY_TTL_MS) {
    return hit.data;
  }

  const base = getApiBaseUrl();
  if (!base) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const url = `${base}/api/weather?region=${encodeURIComponent(region.toLowerCase())}&days=${days}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as WeatherAdvice;
    if (!data?.ok) {
      return null;
    }

    memory.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Filter POI list when weather prefers indoor stops — reduces AI payload too. */
export function applyWeatherPoiFilter<T extends { category: string }>(
  pois: T[],
  weather: WeatherAdvice | null
): T[] {
  if (!weather?.prefer_indoor || !weather.exclude_categories?.length) {
    return pois;
  }
  const exclude = new Set(weather.exclude_categories);
  const filtered = pois.filter((p) => !exclude.has(p.category));
  // Keep at least some stops if filter wiped everything
  return filtered.length >= 5 ? filtered : pois;
}
