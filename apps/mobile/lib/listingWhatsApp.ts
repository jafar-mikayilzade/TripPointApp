/** WhatsApp deep-link helpers for İcma listings. */

/** Digits only, suitable for https://wa.me/<digits> */
export function toWhatsAppDigits(phone: string | null | undefined): string {
  if (!phone) {
    return '';
  }
  return phone.replace(/[^\d]/g, '');
}

/**
 * Prefer listing contact_phone (elan nömrəsi), then creator profile phone.
 */
export function resolveListingWhatsAppPhone(args: {
  contactPhone?: string | null;
  creatorPhone?: string | null;
}): string {
  return (
    toWhatsAppDigits(args.contactPhone) || toWhatsAppDigits(args.creatorPhone) || ''
  );
}

export function buildListingWhatsAppUrl(args: {
  phoneDigits: string;
  creatorName: string;
  listingTitle: string;
}): string {
  const text = encodeURIComponent(
    `Salam ${args.creatorName}! TripPoint-də "${args.listingTitle}" elanınızla maraqlanıram.`
  );
  if (!args.phoneDigits) {
    return '';
  }
  return `https://wa.me/${args.phoneDigits}?text=${text}`;
}
