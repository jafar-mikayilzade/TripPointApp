import { Linking, Platform } from 'react-native';

export type NavStop = {
  lat: number;
  lng: number;
  name?: string;
};

/** Flatten plan days → ordered stops with valid coordinates. */
export function collectRouteStops(plan: {
  days?: Array<{ stops?: Array<{ lat?: unknown; lng?: unknown; name?: string }> }>;
}): NavStop[] {
  const out: NavStop[] = [];
  for (const day of plan.days ?? []) {
    for (const stop of day.stops ?? []) {
      const lat = Number(stop.lat);
      const lng = Number(stop.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        continue;
      }
      out.push({ lat, lng, name: stop.name });
    }
  }
  return out;
}

/**
 * Opens Google Maps turn-by-turn (Waze-like) for a multi-stop route.
 * Full in-app Navigation SDK is costly; this reuses Maps already on the phone.
 * Mobile Maps URLs: origin + destination + up to ~8 waypoints.
 */
export function buildGoogleMapsNavUrl(stops: NavStop[]): string | null {
  if (stops.length < 2) {
    return null;
  }

  const origin = `${stops[0].lat},${stops[0].lng}`;
  const destination = `${stops[stops.length - 1].lat},${stops[stops.length - 1].lng}`;
  const middle = stops.slice(1, -1).slice(0, 8);
  const waypoints =
    middle.length > 0
      ? middle.map((s) => `${s.lat},${s.lng}`).join('|')
      : '';

  let url =
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    `&travelmode=driving` +
    `&dir_action=navigate`;

  if (waypoints) {
    url += `&waypoints=${encodeURIComponent(waypoints)}`;
  }

  return url;
}

export async function openRouteInGoogleMaps(stops: NavStop[]): Promise<void> {
  const url = buildGoogleMapsNavUrl(stops);
  if (!url) {
    throw new Error('Naviqasiya üçün ən azı 2 nöqtə lazımdır');
  }

  const can = await Linking.canOpenURL(url);
  if (!can && Platform.OS === 'android') {
    // Fallback still attempts open — Maps may handle https maps URLs
  }
  await Linking.openURL(url);
}
