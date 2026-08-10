-- Fix ratings uniqueness (was wrongly UNIQUE on target_type alone),
-- allow target_type = 'post', and enable user POI photo uploads for moderation.

-- 1) Ratings: drop broken unique on target_type only
ALTER TABLE public.ratings
  DROP CONSTRAINT IF EXISTS ratings_target_type_key;

DROP INDEX IF EXISTS ratings_target_type_key;
DROP INDEX IF EXISTS ratings_target_type_idx;

-- Proper per-user uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ratings_rater_target_unique'
  ) THEN
    ALTER TABLE public.ratings
      ADD CONSTRAINT ratings_rater_target_unique
      UNIQUE (rater_id, target_type, target_id);
  END IF;
END $$;

-- Expand allowed target types (feed post ratings)
ALTER TABLE public.ratings
  DROP CONSTRAINT IF EXISTS ratings_target_type_check;

ALTER TABLE public.ratings
  ADD CONSTRAINT ratings_target_type_check
  CHECK (target_type = ANY (ARRAY[
    'poi'::text,
    'listing'::text,
    'business'::text,
    'profile'::text,
    'post'::text
  ]));

CREATE INDEX IF NOT EXISTS ratings_target_lookup_idx
  ON public.ratings (target_type, target_id);

-- 2) Users can insert their own pending POI photos (admin moderation queue)
DROP POLICY IF EXISTS "users insert own poi photos" ON public.poi_photos;
CREATE POLICY "users insert own poi photos"
  ON public.poi_photos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = uploaded_by
    AND status = 'pending'
  );

GRANT INSERT ON public.poi_photos TO authenticated;
GRANT SELECT, UPDATE ON public.poi_photos TO authenticated;

NOTIFY pgrst, 'reload schema';
