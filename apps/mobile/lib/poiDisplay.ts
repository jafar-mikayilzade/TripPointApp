/** Display helpers for POI fields (price, AZ-only text, amenities). */

const CYRILLIC_RE = /[\u0400-\u04FF]/;

/** Reject descriptions that are clearly not Azerbaijani (e.g. Russian). */
export function isAzerbaijaniDisplayText(text: string | null | undefined): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (CYRILLIC_RE.test(t)) return false;
  return true;
}

export function displayPoiDescription(
  text: string | null | undefined
): string | null {
  const t = (text || '').trim();
  if (!t || !isAzerbaijaniDisplayText(t)) return null;
  return t;
}

export function formatPoiPrice(
  priceFrom: number | null | undefined,
  currency: string | null | undefined
): string | null {
  if (priceFrom == null || !Number.isFinite(Number(priceFrom))) return null;
  const value = Number(priceFrom);
  const cur = (currency || 'AZN').trim().toUpperCase() || 'AZN';
  const rounded =
    value >= 100 ? Math.round(value).toString() : value.toFixed(value % 1 ? 2 : 0);
  return `~${rounded} ${cur} / gecə`;
}

const AMENITY_AZ: Record<string, string> = {
  'free wi-fi': 'Pulsuz Wi-Fi',
  'free wifi': 'Pulsuz Wi-Fi',
  wifi: 'Wi-Fi',
  'free parking': 'Pulsuz parkinq',
  parking: 'Parkinq',
  pool: 'Hovuz',
  'indoor pool': 'Qapalı hovuz',
  'outdoor pool': 'Açıq hovuz',
  spa: 'Spa',
  'hot tub': 'Cakuzi',
  'fitness center': 'Fitnes mərkəzi',
  gym: 'İdman zalı',
  restaurant: 'Restoran',
  'air conditioning': 'Kondisioner',
  'airport shuttle': 'Hava limanı transferi',
  'kid-friendly': 'Uşaqlar üçün uyğun',
  'pet-friendly': 'Heyvanlar qəbul olunur',
  'room service': 'Otaq xidməti',
  breakfast: 'Səhər yeməyi',
  'breakfast ($)': 'Səhər yeməyi (pullu)',
  'beach access': 'Çimərliyə çıxış',
  balcony: 'Balkon',
  elevator: 'Lift',
  'smoke-free': 'Siqaretsiz',
  washer: 'Paltaryuyan',
  kitchen: 'Mətbəx',
  'bar': 'Bar',
  sauna: 'Sauna',
  'crib': 'Uşaq beşiyi',
  'wheelchair accessible': 'Əlillər üçün əlçatan',
};

export function translateAmenity(raw: string): string {
  const key = raw.trim().toLowerCase();
  return AMENITY_AZ[key] ?? raw.trim();
}

export function translateAmenities(
  amenities: string[] | null | undefined
): string[] {
  if (!Array.isArray(amenities)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of amenities) {
    if (!item || typeof item !== 'string') continue;
    // Skip Cyrillic amenity labels
    if (CYRILLIC_RE.test(item)) continue;
    const label = translateAmenity(item);
    const k = label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(label);
  }
  return out;
}
