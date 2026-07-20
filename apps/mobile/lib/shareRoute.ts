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

/**
 * PDF when expo-print is in the native binary; otherwise falls back to text share.
 * Lazy-requires native modules so older dev-clients still boot.
 */
export async function shareRoutePdf(
  route: PlannedRoute,
  region: string,
  weatherNote?: string | null
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Print = require('expo-print') as typeof import('expo-print');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

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

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
      <h1>TripPoint — ${escapeHtml(region)}</h1>
      <p>${escapeHtml(route.summary ?? '')}</p>
      ${weatherNote ? `<p>${escapeHtml(weatherNote)}</p>` : ''}
      ${daysHtml}
    </body></html>`;

    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Marşrutu paylaş',
        UTI: 'com.adobe.pdf',
      });
      return;
    }
  } catch {
    // Native module missing in current dev-client — text share still works
  }

  await shareRouteText(route, region, weatherNote);
}
