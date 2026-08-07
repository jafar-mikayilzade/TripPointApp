-- SerpAPI Google Hotels fields for lodging POIs.
-- Price is a snapshot from the import check-in date (not live rates).

ALTER TABLE public.pois
  ADD COLUMN IF NOT EXISTS price_from numeric(12, 2),
  ADD COLUMN IF NOT EXISTS price_currency text,
  ADD COLUMN IF NOT EXISTS hotel_class smallint,
  ADD COLUMN IF NOT EXISTS amenities jsonb,
  ADD COLUMN IF NOT EXISTS check_in_time text,
  ADD COLUMN IF NOT EXISTS check_out_time text,
  ADD COLUMN IF NOT EXISTS data_source text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

COMMENT ON COLUMN public.pois.price_from IS
  'Lowest nightly rate snapshot from last lodging import (e.g. SerpAPI Google Hotels)';
COMMENT ON COLUMN public.pois.price_currency IS
  'ISO currency for price_from (e.g. AZN, USD)';
COMMENT ON COLUMN public.pois.hotel_class IS
  'Star class 1–5 when known';
COMMENT ON COLUMN public.pois.amenities IS
  'JSON array of amenity strings from lodging source';
COMMENT ON COLUMN public.pois.check_in_time IS
  'Typical check-in time from lodging source';
COMMENT ON COLUMN public.pois.check_out_time IS
  'Typical check-out time from lodging source';
COMMENT ON COLUMN public.pois.data_source IS
  'Ingest source marker: serpapi | osm | google | manual';
COMMENT ON COLUMN public.pois.thumbnail_url IS
  'Primary thumbnail URL from external lodging source';

CREATE INDEX IF NOT EXISTS pois_price_from_idx
  ON public.pois (price_from ASC NULLS LAST);

CREATE INDEX IF NOT EXISTS pois_data_source_idx
  ON public.pois (data_source);

NOTIFY pgrst, 'reload schema';
