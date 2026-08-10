/** Contact helpers for hospitality POIs (call + WhatsApp). */

import type { PoiCategory } from '../types/database';

const CONTACTABLE_CATEGORIES = new Set<string>([
  'hotel',
  'hostel',
  'guesthouse',
  'restaurant',
  'home_restaurant',
]);

export function isContactablePoiCategory(category: string | null | undefined): boolean {
  if (!category) {
    return false;
  }
  return CONTACTABLE_CATEGORIES.has(category);
}

/** Digits only */
export function toPhoneDigits(phone: string | null | undefined): string {
  if (!phone) {
    return '';
  }
  return phone.replace(/[^\d]/g, '');
}

/** Normalize AZ / international numbers to digits with country code when possible. */
export function toInternationalPhoneDigits(phone: string | null | undefined): string {
  let digits = toPhoneDigits(phone);
  if (!digits) {
    return '';
  }
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0') && digits.length >= 10) {
    digits = `994${digits.slice(1)}`;
  } else if (!digits.startsWith('994') && digits.length === 9) {
    digits = `994${digits}`;
  }
  return digits;
}

export function buildPoiTelUrl(phone: string | null | undefined): string | null {
  const digits = toInternationalPhoneDigits(phone);
  if (!digits) {
    return null;
  }
  return `tel:+${digits}`;
}

export function buildPoiWhatsAppUrl(args: {
  phone: string | null | undefined;
  placeName: string;
}): string | null {
  const digits = toInternationalPhoneDigits(args.phone);
  if (!digits) {
    return null;
  }
  const text = encodeURIComponent(
    `Salam! TripPoint-də "${args.placeName}" haqqında məlumat almaq istəyirəm.`
  );
  return `https://wa.me/${digits}?text=${text}`;
}

export function shouldShowPoiContact(
  category: PoiCategory | string | null | undefined,
  phone: string | null | undefined
): boolean {
  return isContactablePoiCategory(category) && toInternationalPhoneDigits(phone).length >= 10;
}

/** Ensure website opens in browser (https only). */
export function buildPoiWebsiteUrl(website: string | null | undefined): string | null {
  const raw = (website || '').trim();
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('file:') ||
    lower.startsWith('vbscript:')
  ) {
    return null;
  }
  let candidate = raw;
  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  } else if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  if (!/^https:\/\//i.test(candidate)) {
    // Force https — reject plain http to avoid mixed content / downgrade
    candidate = candidate.replace(/^http:\/\//i, 'https://');
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
