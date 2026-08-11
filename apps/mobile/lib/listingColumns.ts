/** Safe listing column sets — never over-fetch payment_card on public lists. */

/** Public feed / community / favorites — excludes payment_card (PAN). */
export const LISTING_PUBLIC_COLUMNS = [
  'id',
  'created_by',
  'type',
  'title',
  'description',
  'origin_text',
  'destination_text',
  'region',
  'departure_at',
  'capacity',
  'spots_left',
  'price',
  'price_type',
  'contact_phone',
  'status',
  'created_at',
  'updated_at',
].join(', ');

/** Creator profile fields safe to show on listing cards. */
export const PROFILE_PUBLIC_COLUMNS = [
  'id',
  'full_name',
  'avatar_url',
  'phone',
  'is_verified',
].join(', ');
