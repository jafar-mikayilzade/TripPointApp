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

function normalizeListingRouteStops(raw: unknown): ListingRouteStop[] {
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

/** ASCII-safe: Marşrut / Marsrut / Marșrut (encoding fərqləri üçün) */
const ROUTE_HEADER_RE = /mar[sşș]rut\s*:/i;

function findRouteHeaderIndex(text: string): number {
  return text.search(ROUTE_HEADER_RE);
}

function stripRouteHeaderPrefix(text: string): string {
  return text.replace(/^\s*mar[sşș]rut\s*:\s*/i, '');
}

/** Köhnə elanlar: təsvirdə "Marşrut:\n1. Ad" formatı */
function parseRouteStopsFromDescription(description: string | null): ListingRouteStop[] {
  if (!description) {
    return [];
  }

  const idx = findRouteHeaderIndex(description);
  if (idx < 0) {
    // Header yoxdur — bəzi elanlarda yalnız nömrəli siyahı / oxlu mətn olur
    return parseNumberedStops(description);
  }

  const after = stripRouteHeaderPrefix(description.slice(idx));
  return parseNumberedStops(after);
}

function parseNumberedStops(text: string): ListingRouteStop[] {
  const lines = text.split('\n');
  const out: ListingRouteStop[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
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
    if (out.length > 0) {
      break;
    }
  }

  return out;
}

function isArrowItineraryLine(line: string): boolean {
  // "A → B → C" / "A -> B -> C" / "A — B — C"
  return /→|->|⇒|⟶/.test(line) || (line.split(/\s+[—–-]\s+/).length >= 3 && line.length > 40);
}

function isNumberedStopLine(line: string): boolean {
  return /^\d+[\.)]\s+\S+/.test(line);
}

/**
 * Təsvirdən bütün marşrut məzmununu çıxarır.
 * UI-də marşrut YALNIZ "Marşrut" düyməsi altında göstərilir.
 */
export function stripRouteBlockFromDescription(description: string | null): string {
  if (!description) {
    return '';
  }

  let text = description.replace(/\r\n/g, '\n');

  // 1) "Marşrut:" başlıqlı blok + ardınca nömrəli sətirlər
  const idx = findRouteHeaderIndex(text);
  if (idx >= 0) {
    const before = text.slice(0, idx).trimEnd();
    const afterRaw = stripRouteHeaderPrefix(text.slice(idx));
    const lines = afterRaw.split('\n');
    let i = 0;
    while (i < lines.length && !lines[i].trim()) {
      i += 1;
    }
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) {
        i += 1;
        break;
      }
      if (isNumberedStopLine(line)) {
        i += 1;
        continue;
      }
      break;
    }
    text = [before, lines.slice(i).join('\n').trim()].filter(Boolean).join('\n\n');
  }

  // 2) Oxlu itinerary sətirləri və təmiz nömrəli siyahılar
  const kept: string[] = [];
  let skippingNumberedRun = false;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      skippingNumberedRun = false;
      if (kept.length > 0 && kept[kept.length - 1] !== '') {
        kept.push('');
      }
      continue;
    }

    if (isArrowItineraryLine(line)) {
      skippingNumberedRun = false;
      continue;
    }

    if (isNumberedStopLine(line)) {
      skippingNumberedRun = true;
      continue;
    }

    // "Marşrut" tək başına qalıbsa
    if (ROUTE_HEADER_RE.test(line) && line.replace(ROUTE_HEADER_RE, '').trim() === '') {
      continue;
    }

    if (skippingNumberedRun) {
      skippingNumberedRun = false;
    }
    kept.push(raw.trimEnd());
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Elan detallarında göstəriləcək təsvir.
 * Tur/carpool-da marşrut heç vaxt yuxarıda görünməsin.
 */
export function getListingDisplayDescription(
  listing: Pick<Listing, 'type' | 'description' | 'route_stops'>
): string {
  const stripped = stripRouteBlockFromDescription(listing.description);
  if (!stripped) {
    return '';
  }

  if (listing.type !== 'tour' && listing.type !== 'carpool') {
    return stripped;
  }

  const lines = stripped
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return '';
  }

  const routeLikeCount = lines.filter(
    (l) => isArrowItineraryLine(l) || isNumberedStopLine(l) || ROUTE_HEADER_RE.test(l)
  ).length;
  if (routeLikeCount === lines.length) {
    return '';
  }

  // Qısa fraqmentlər (köhnə təmizlikdən qalan) — marşrut varsa gizlət
  const hasStops =
    normalizeListingRouteStops(listing.route_stops).length > 0 ||
    parseRouteStopsFromDescription(listing.description).length > 0;
  if (hasStops && stripped.length < 48 && !/[.!?…]/.test(stripped)) {
    return '';
  }

  return stripped;
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

function buildMapsPlaceUrl(stop: ListingRouteStop): string {
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
