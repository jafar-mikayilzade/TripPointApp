/**
 * İkiqat marşrut optimallaşdırması:
 * 1) Coğrafi Nearest Neighbor (backtracking yox)
 * 2) Strict xronoloji saat oxu (09:00 → 10:30 → … yalnız artan)
 */

export type RoutePoint = {
  lat: number;
  lng: number;
  /** Ziyarət müddəti mətni, məs: "2 saat", "45 dəq" */
  duration?: string | null;
  /** AI-dan gələn saat (yenidən hesablanacaq) */
  time?: string | null;
};

export type OptimizeRouteOptions = {
  /** Verilərsə, bu nöqtəyə ən yaxın POİ-dən başlanır. */
  startLat?: number;
  startLng?: number;
  /** Günün başlanğıc saati (HH:mm). Default: 09:00 */
  dayStartTime?: string;
  /** Orta hərəkət sürəti (km/saat) — gediş vaxtı üçün. Default: 35 */
  avgSpeedKmh?: number;
  /** Stop-lar arası minimum keçid (dəqiqə). Default: 10 */
  minTravelMinutes?: number;
};

export type OptimizedRoutePoint<T extends RoutePoint> = T & {
  /** 1-based ardıcıllıq (xəritə marker). */
  sequence_order: number;
  /** Dinamik hesablanmış ziyarət saati (HH:mm). */
  visiting_time: string;
  /** UI ilə uyğunluq üçün `time` də eyni dəyər. */
  time: string;
};

const EARTH_RADIUS_KM = 6371;
const DEFAULT_VISIT_MINUTES = 60;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Haversine məsafəsi (km). */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function tourLengthKm<T extends RoutePoint>(ordered: T[]): number {
  let total = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    total += haversineKm(ordered[i], ordered[i + 1]);
  }
  return total;
}

/** "09:00" → dəqiqə (0–1439). */
export function parseTimeToMinutes(hhmm: string): number {
  const match = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return 9 * 60;
  }
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return hours * 60 + minutes;
}

/** Dəqiqə → "09:00". */
export function formatMinutesToTime(totalMinutes: number): string {
  const day = 24 * 60;
  const normalized = ((totalMinutes % day) + day) % day;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * "2 saat", "1.5 hour", "45 dəq", "90 min" → dəqiqə.
 * Parse alınmazsa default 60 dəq.
 */
export function parseDurationMinutes(duration?: string | null): number {
  if (!duration || typeof duration !== 'string') {
    return DEFAULT_VISIT_MINUTES;
  }

  const s = duration.toLowerCase().trim();
  let minutes = 0;

  const hourMatch = s.match(/(\d+(?:[.,]\d+)?)\s*(saat|hours?|hrs?|h\b)/i);
  if (hourMatch) {
    minutes += parseFloat(hourMatch[1].replace(',', '.')) * 60;
  }

  const minMatch = s.match(/(\d+)\s*(dəq|deq|dəqiqə|minutes?|mins?|m\b)/i);
  if (minMatch) {
    minutes += parseInt(minMatch[1], 10);
  }

  if (minutes <= 0) {
    const bareHour = s.match(/^(\d+(?:[.,]\d+)?)$/);
    if (bareHour) {
      minutes = parseFloat(bareHour[1].replace(',', '.')) * 60;
    }
  }

  return minutes > 0 ? Math.round(minutes) : DEFAULT_VISIT_MINUTES;
}

/** Məsafəyə görə təxmini gediş vaxtı (dəqiqə). */
export function estimateTravelMinutes(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  avgSpeedKmh = 35,
  minTravelMinutes = 10
): number {
  const km = haversineKm(from, to);
  const mins = Math.round((km / Math.max(avgSpeedKmh, 1)) * 60);
  return Math.max(minTravelMinutes, mins);
}

function nearestNeighborFromIndex<T extends RoutePoint>(
  points: T[],
  startIndex: number
): T[] {
  if (points.length === 0) {
    return [];
  }

  const remaining = [...points];
  const route: T[] = [];

  let current = remaining.splice(startIndex, 1)[0];
  route.push(current);

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineKm(current, remaining[i]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    current = remaining.splice(bestIdx, 1)[0];
    route.push(current);
  }

  return route;
}

function findStartIndexNear<T extends RoutePoint>(
  points: T[],
  startLat: number,
  startLng: number
): number {
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  const origin = { lat: startLat, lng: startLng };

  for (let i = 0; i < points.length; i++) {
    const dist = haversineKm(origin, points[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function orderByNearestNeighbor<T extends RoutePoint>(
  points: T[],
  options: OptimizeRouteOptions
): T[] {
  if (points.length <= 1) {
    return [...points];
  }

  if (
    typeof options.startLat === 'number' &&
    typeof options.startLng === 'number' &&
    Number.isFinite(options.startLat) &&
    Number.isFinite(options.startLng)
  ) {
    const startIdx = findStartIndexNear(points, options.startLat, options.startLng);
    return nearestNeighborFromIndex(points, startIdx);
  }

  let bestTour = nearestNeighborFromIndex(points, 0);
  let bestLength = tourLengthKm(bestTour);

  for (let i = 1; i < points.length; i++) {
    const tour = nearestNeighborFromIndex(points, i);
    const length = tourLengthKm(tour);
    if (length < bestLength) {
      bestLength = length;
      bestTour = tour;
    }
  }

  return bestTour;
}

/**
 * Coğrafi NN sırası + xronoloji saat oxu.
 *
 * Qaydalar:
 * - İlkin massiv sırası / AI saatları ignore olunur
 * - Hər növbəti stop əvvəlkinə ən yaxın qalan nöqtədir
 * - Saatlar yalnız artır: start → +ziyarət → +gediş → …
 * - `sequence_order` və `visiting_time` / `time` sinxron yazılır
 */
export function optimizeRoute<T extends RoutePoint>(
  points: T[],
  options: OptimizeRouteOptions = {}
): OptimizedRoutePoint<T>[] {
  const valid = points.filter((p) => {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    return Number.isFinite(lat) && Number.isFinite(lng);
  }).map((p) => ({
    ...p,
    lat: Number(p.lat),
    lng: Number(p.lng),
  }));

  if (valid.length === 0) {
    return [];
  }

  const ordered = orderByNearestNeighbor(valid, options);
  const dayStart = parseTimeToMinutes(options.dayStartTime ?? '09:00');
  const avgSpeed = options.avgSpeedKmh ?? 35;
  const minTravel = options.minTravelMinutes ?? 10;

  let cursor = dayStart;

  return ordered.map((point, index) => {
    const visiting_time = formatMinutesToTime(cursor);
    const visitMinutes = parseDurationMinutes(point.duration);

    // Növbəti stop üçün cursor irəli: ziyarət + gediş
    cursor += visitMinutes;
    if (index < ordered.length - 1) {
      cursor += estimateTravelMinutes(point, ordered[index + 1], avgSpeed, minTravel);
    }

    return {
      ...point,
      sequence_order: index + 1,
      visiting_time,
      time: visiting_time,
    };
  });
}

/**
 * Hər günün stop-larını ayrıca optimallaşdırır (günlər qarışdırılmır).
 * Hər gün səhər 09:00-dan başlayan öz timeline-ına malikdir.
 */
export function optimizePlanDays<
  TDay extends { stops?: TStop[] | null },
  TStop extends RoutePoint,
>(
  days: TDay[],
  options: OptimizeRouteOptions = {}
): Array<TDay & { stops: OptimizedRoutePoint<TStop>[] }> {
  return days.map((day) => {
    const stops = Array.isArray(day.stops) ? day.stops : [];
    return {
      ...day,
      stops: optimizeRoute(stops as TStop[], {
        dayStartTime: '09:00',
        ...options,
      }),
    };
  });
}
