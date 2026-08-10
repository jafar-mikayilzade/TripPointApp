-- Rich hospitality fields for hotels/restaurants (Booking / SerpAPI / Geoapify / TA).

ALTER TABLE public.pois
  ADD COLUMN IF NOT EXISTS photo_urls jsonb,
  ADD COLUMN IF NOT EXISTS cuisine text,
  ADD COLUMN IF NOT EXISTS external_url text;

COMMENT ON COLUMN public.pois.photo_urls IS
  'JSON array of external gallery image URLs from lodging/restaurant imports';
COMMENT ON COLUMN public.pois.cuisine IS
  'Restaurant cuisine / food type when known';
COMMENT ON COLUMN public.pois.external_url IS
  'Canonical booking or listing URL (Booking.com, TripAdvisor, Google Hotels, etc.)';

CREATE INDEX IF NOT EXISTS pois_cuisine_idx
  ON public.pois (cuisine)
  WHERE cuisine IS NOT NULL;

NOTIFY pgrst, 'reload schema';
