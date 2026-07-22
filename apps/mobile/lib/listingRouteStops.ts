import { Linking } from 'react-native';

import type { Listing } from '../types/database';

export type ListingRouteStop = {
  name: string;
  lat: number | null;
  lng: number | null;
  poi_id?: string | null;
  source?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeListingRouteStops(raw: unknown): ListingRouteStop[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const out: ListingRouteStop[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const name = String(item.name ?? '').trim();
    if (!name) {
      continue;
    }
    const lat = item.lat != null ? Number(item.lat) : NaN;
    const lng = item.lng != null ? Number(item.lng) : NaN;
    out.push({
      name,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      poi_id: item.poi_id != null ? String(item.poi_id) : null,
      source: item.source != null ? String(item.source) : null,
    });
  }
  return out;
}

/** Köhnə elanlar: təsvirdə "Marşrut:\n1. Ad" formatı */
export function parseRouteStopsFromDescription(description: string | null): ListingRouteStop[] {
  if (!description) {
    return [];
  }

  const idx = description.search(/Marşrut\s*:/i);
  if (idx < 0) {
    return [];
  }

  const after = description.slice(idx).replace(/^Marşrut\s*:\s*/i, '');
  const lines = after.split('\n');
  const out: ListingRouteStop[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      // boş sətir — blok bitib ola bilər
      if (out.length > 0) {
        break;
      }
      continue;
    }
    const numbered = line.match(/^\d+[\.)]\s*(.+)$/);
    if (numbered?.[1]) {
      out.push({ name: numbered[1].trim(), lat: null, lng: null });
      continue;
    }
    // nömrəsiz sətir gələndə marşrut bloku bitib
    if (out.length > 0) {
      break;
    }
  }

  return out;
}

export function resolveListingRouteStops(
  listing: Pick<Listing, 'route_stops' | 'description'>
): ListingRouteStop[] {
  const fromColumn = normalizeListingRouteStops(listing.route_stops);
  if (fromColumn.length > 0) {
    return fromColumn;
  }
  return parseRouteStopsFromDescription(listing.description);
}

export function buildMapsPlaceUrl(stop: ListingRouteStop): string {
  if (
    stop.lat != null &&
    stop.lng != null &&
    Number.isFinite(stop.lat) &&
    Number.isFinite(stop.lng)
  ) {
    return `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}`;
}

export async function openStopInMaps(stop: ListingRouteStop): Promise<void> {
  await Linking.openURL(buildMapsPlaceUrl(stop));
}
