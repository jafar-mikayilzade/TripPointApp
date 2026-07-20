import { Share, Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatRouteShareText(
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

function buildRouteHtml(route: PlannedRoute, region: string, weatherNote?: string | null): string {
  const daysHtml = (route.days ?? [])
    .map((day) => {
      const stops = (day.stops ?? [])
        .map(
          (s) =>
            `<li><strong>${escapeHtml(s.time ?? '')}</strong> ${escapeHtml(s.name ?? '')}</li>`
        )
        .join('');
      return `<h2>Gün ${day.day ?? ''} — ${escapeHtml(day.title ?? '')}</h2><ul>${stops}</ul>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  body { font-family: -apple-system, sans-serif; padding: 24px; color: #1a1a1c; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  h2 { font-size: 16px; margin-top: 18px; }
  p { color: #555; }
  ul { padding-left: 18px; }
  li { margin: 4px 0; }
</style></head>
<body>
  <h1>TripPoint — ${escapeHtml(region)}</h1>
  <p>${escapeHtml(route.summary ?? '')}</p>
  ${weatherNote ? `<p>${escapeHtml(weatherNote)}</p>` : ''}
  ${daysHtml}
  ${route.total_cost ? `<p><strong>Ümumi:</strong> ${escapeHtml(route.total_cost)}</p>` : ''}
</body></html>`;
}

/** Share as text (WhatsApp / system sheet) — zero server cost. */
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

/** Export PDF locally then open share sheet (WhatsApp qrupu və s.). */
export async function shareRoutePdf(
  route: PlannedRoute,
  region: string,
  weatherNote?: string | null
): Promise<void> {
  const html = buildRouteHtml(route, region, weatherNote);
  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    await shareRouteText(route, region, weatherNote);
    return;
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Marşrutu paylaş',
    UTI: 'com.adobe.pdf',
  });
}
