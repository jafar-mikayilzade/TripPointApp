-- Multi-category POIs: keep primary `category` for filters; `categories` holds all tags.
-- Best-practice for this codebase: array column + primary scalar (not junction yet).

ALTER TABLE public.pois
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';

UPDATE public.pois
SET categories = ARRAY[category]::text[]
WHERE coalesce(cardinality(categories), 0) = 0
  AND category IS NOT NULL
  AND length(trim(category)) > 0;

UPDATE public.pois
SET categories = ARRAY['other']::text[]
WHERE coalesce(cardinality(categories), 0) = 0;

CREATE INDEX IF NOT EXISTS pois_categories_gin ON public.pois USING gin (categories);

COMMENT ON COLUMN public.pois.categories IS
  'All POI categories (e.g. hotel + restaurant). Primary display/filter key remains category = categories[1].';
