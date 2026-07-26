/** Parse Google weekday_text (or free text) into a short open/closed label. */

const EN_DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type OpenStatus = 'open' | 'closed' | 'unknown';

export type OpeningHoursSummary = {
  status: OpenStatus;
  /** Short chip: «Açıq», «Qapalı», or truncated hours */
  label: string;
  /** Full raw text for detail */
  detail: string;
};

function todayEnglishDay(): string {
  return EN_DAYS[new Date().getDay()];
}

/** Extract today's line from multiline weekday_text if present. */
function todayLine(raw: string): string | null {
  const day = todayEnglishDay();
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => l.toLowerCase().startsWith(day.toLowerCase()));
  return hit ?? null;
}

function classifyLine(line: string): OpenStatus {
  const lower = line.toLowerCase();
  if (
    /\bclosed\b/.test(lower) ||
    /\bqapalı\b/.test(lower) ||
    /\bqapali\b/.test(lower)
  ) {
    return 'closed';
  }
  // "Monday: 9:00 AM – 5:00 PM" / "24 hours"
  if (
    /\d/.test(line) ||
    /\bopen\b/.test(lower) ||
    /\b24\b/.test(lower) ||
    /\baçıq\b/.test(lower) ||
    /\baciq\b/.test(lower)
  ) {
    return 'open';
  }
  return 'unknown';
}

export function summarizeOpeningHours(
  raw: string | null | undefined
): OpeningHoursSummary | null {
  const detail = (raw ?? '').trim();
  if (!detail) {
    return null;
  }

  const line = todayLine(detail) ?? detail.split(/\r?\n/)[0]?.trim() ?? detail;
  const status = classifyLine(line);

  if (status === 'open') {
    return { status, label: 'Açıq', detail };
  }
  if (status === 'closed') {
    return { status, label: 'Qapalı', detail };
  }
  const short = line.length > 48 ? `${line.slice(0, 45)}…` : line;
  return { status: 'unknown', label: short, detail };
}

/** Active sponsorship: flagged and not past sponsor_until. */
export function isPoiSponsored(poi: {
  is_sponsored?: boolean | null;
  sponsor_until?: string | null;
}): boolean {
  if (!poi.is_sponsored) {
    return false;
  }
  if (!poi.sponsor_until) {
    return true;
  }
  const until = Date.parse(poi.sponsor_until);
  if (Number.isNaN(until)) {
    return true;
  }
  return until > Date.now();
}
