import type { NavStop } from './openNavigation';

export type ManualStopSource = 'poi' | 'map' | 'search';

export type ManualStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category?: string;
  source: ManualStopSource;
};

/** Google Maps dir: origin + destination + ~8 waypoints ≈ 10 nöqtə cəmi. */
export const MANUAL_ROUTE_MAX_NAV_POINTS = 10;

/** Marşrut stop limiti (cari məkan ayrıca sayılır). */
export function maxRouteStops(fromOrigin: boolean): number {
  return fromOrigin ? MANUAL_ROUTE_MAX_NAV_POINTS - 1 : MANUAL_ROUTE_MAX_NAV_POINTS;
}

export const POI_PAGE_SIZE = 12;

export function createManualStop(input: {
  name: string;
  lat: number;
  lng: number;
  category?: string;
  source: ManualStopSource;
  poiId?: string;
}): ManualStop {
  return {
    id: input.poiId ?? `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || 'Nöqtə',
    lat: input.lat,
    lng: input.lng,
    category: input.category,
    source: input.source,
  };
}

export function removeStop(stops: ManualStop[], id: string): ManualStop[] {
  return stops.filter((s) => s.id !== id);
}

export function moveStop(stops: ManualStop[], fromIndex: number, toIndex: number): ManualStop[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= stops.length ||
    toIndex >= stops.length ||
    fromIndex === toIndex
  ) {
    return stops;
  }
  const next = [...stops];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function insertStopAfter(
  stops: ManualStop[],
  afterIndex: number,
  stop: ManualStop
): ManualStop[] {
  const next = [...stops];
  next.splice(afterIndex + 1, 0, stop);
  return next;
}

export function replaceStopAt(
  stops: ManualStop[],
  index: number,
  stop: ManualStop
): ManualStop[] {
  if (index < 0 || index >= stops.length) {
    return stops;
  }
  const next = [...stops];
  next[index] = stop;
  return next;
}

export function manualStopsToNavStops(
  stops: ManualStop[],
  origin?: { lat: number; lng: number; name?: string } | null
): NavStop[] {
  const route = stops.map((s) => ({ lat: s.lat, lng: s.lng, name: s.name }));
  if (origin) {
    return [{ lat: origin.lat, lng: origin.lng, name: origin.name ?? 'Mənim yerim' }, ...route];
  }
  return route;
}

export function manualStopsToShareRoute(
  stops: ManualStop[],
  regionLabel: string,
  options?: { fromOrigin?: boolean; legHint?: string | null }
) {
  const summaryParts = [
    `${regionLabel} — özün qurduğun marşrut (${stops.length} nöqtə)`,
  ];
  if (options?.fromOrigin) {
    summaryParts.push('Başlanğıc: cari məkan');
  }
  if (options?.legHint) {
    summaryParts.push(options.legHint);
  }

  const dayStops = [
    ...(options?.fromOrigin
      ? [{ time: '•', name: 'Mənim yerim (cari)' }]
      : []),
    ...stops.map((s, i) => ({
      time: `${i + 1}.`,
      name: s.name,
      category: s.category,
    })),
  ];

  return {
    summary: summaryParts.join(' · '),
    days: [
      {
        day: 1,
        title: regionLabel,
        stops: dayStops,
      },
    ],
  };
}

export type LatLng = { latitude: number; longitude: number };

export function stopsToPolyline(stops: ManualStop[]): LatLng[] {
  return stops.map((s) => ({ latitude: s.lat, longitude: s.lng }));
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Orta sürət ~70 km/s — təxmini yol vaxtı. */
export function estimateDriveLabel(km: number, avgKmh = 70): string {
  if (!Number.isFinite(km) || km < 0) {
    return '';
  }
  const hours = km / avgKmh;
  const kmText = km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `~${kmText} · ~${mins} dəq`;
  }
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `~${kmText} · ~${h} saat ${m} dəq` : `~${kmText} · ~${h} saat`;
}

export function formatOriginToFirstLeg(
  origin: { lat: number; lng: number },
  first: ManualStop
): string {
  const km = haversineKm(origin.lat, origin.lng, first.lat, first.lng);
  return `Cari yer → 1. ${first.name}: ${estimateDriveLabel(km)}`;
}
