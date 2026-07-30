import { Share, Platform } from 'react-native';

type RouteStop = {
  time?: string;
  name?: string;
  category?: string;
  tip?: string;
};

type RouteDay = {
  day?: number;
  title?: string;
  stops?: RouteStop[];
  estimated_cost?: string;
  notes?: string;
};

type PlannedRoute = {
  summary?: string;
  days?: RouteDay[];
  total_cost?: string;
  best_time?: string;
};

function formatRouteShareText(
  route: PlannedRoute,
  region: string,
  weatherNote?: string | null
): string {
  const lines: string[] = [`TripPoint · ${region} marşrutu`, ''];
  if (route.summary) {
    lines.push(route.summary, '');
  }
  if (weatherNote) {
    lines.push(`🌦 ${weatherNote}`, '');
  }

  for (const day of route.days ?? []) {
    lines.push(`Gün ${day.day ?? ''} — ${day.title ?? ''}`.trim());
    for (const stop of day.stops ?? []) {
      lines.push(`  ${stop.time ?? ''} ${stop.name ?? ''}`.trim());
    }
    if (day.estimated_cost) {
      lines.push(`  Büdcə: ${day.estimated_cost}`);
    }
    lines.push('');
  }

  if (route.total_cost) {
    lines.push(`Ümumi: ${route.total_cost}`);
  }
  lines.push('', 'trippoint://');
  return lines.join('\n');
}

/** Share as text (WhatsApp / system sheet) — no extra native modules. */
export async function shareRouteText(
  route: PlannedRoute,
  region: string,
  weatherNote?: string | null
): Promise<void> {
  const message = formatRouteShareText(route, region, weatherNote);
  await Share.share(
    Platform.OS === 'ios' ? { message } : { message, title: 'TripPoint marşrutu' }
  );
}