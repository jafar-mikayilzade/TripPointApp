-- External ratings from Google Places (OSM rarely has stars → NULL)
ALTER TABLE public.pois
  ADD COLUMN IF NOT EXISTS rating numeric(3, 2),
  ADD COLUMN IF NOT EXISTS rating_count integer;

COMMENT ON COLUMN public.pois.rating IS 'External source rating (e.g. Google Places 1.0–5.0); NULL if unknown';
COMMENT ON COLUMN public.pois.rating_count IS 'External review count (Google user_ratings_total)';

CREATE INDEX IF NOT EXISTS pois_rating_idx ON public.pois (rating DESC NULLS LAST);
