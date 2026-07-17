export type POI = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string;
  /** Məkanda qalma müddəti (saat). Default: 1.5 */
  duration_hours?: number;
};

export type OptimizedStep = POI & {
  sequence_order: number;
  arrival_time: string;
};

/** İki koordinat arası məsafə (Haversine, km). */
const getDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/** Saat (məs. 9.5) → "09:30" */
const formatHoursToTime = (totalHours: number): string => {
  const dayHours = ((totalHours % 24) + 24) % 24;
  const hours = Math.floor(dayHours);
  const minutes = Math.round((dayHours - hours) * 60) % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

/**
 * Nearest Neighbor + xronoloji timeline.
 * Başlanğıc nöqtəsindən başlayaraq hər dəfə ən yaxın POİ seçilir;
 * saat yalnız artır (gediş + ziyarət).
 */
export const optimizeRouteAndTimeline = (
  pois: POI[],
  startLat: number,
  startLng: number,
  startTimeStr: string = '09:00'
): OptimizedStep[] => {
  const unvisited = [...pois];
  const optimized: OptimizedStep[] = [];

  const [startH, startM] = startTimeStr.split(':').map(Number);
  let currentHours = (startH || 9) + (startM || 0) / 60;

  let currentLat = startLat;
  let currentLng = startLng;
  let order = 1;

  while (unvisited.length > 0) {
    let closestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = getDistance(currentLat, currentLng, unvisited[i].lat, unvisited[i].lng);
      if (dist < minDistance) {
        minDistance = dist;
        closestIndex = i;
      }
    }

    const nextPoi = unvisited.splice(closestIndex, 1)[0];

    // Əvvəl gediş vaxtı, sonra çatma saati
    const travelTime = minDistance / 30; // ~30 km/s
    currentHours += travelTime;

    optimized.push({
      ...nextPoi,
      sequence_order: order,
      arrival_time: formatHoursToTime(currentHours),
    });

    // Məkanda qalma
    const duration = nextPoi.duration_hours || 1.5;
    currentHours += duration;

    currentLat = nextPoi.lat;
    currentLng = nextPoi.lng;
    order += 1;
  }

  return optimized;
};

/** "2 saat" / "90 dəq" → saat (number). */
export function parseDurationHours(duration?: string | null): number {
  if (!duration) {
    return 1.5;
  }
  const s = duration.toLowerCase();
  const hourMatch = s.match(/(\d+(?:[.,]\d+)?)\s*(saat|hours?|h\b)/);
  if (hourMatch) {
    return parseFloat(hourMatch[1].replace(',', '.'));
  }
  const minMatch = s.match(/(\d+)\s*(dəq|deq|min)/);
  if (minMatch) {
    return parseInt(minMatch[1], 10) / 60;
  }
  return 1.5;
}
