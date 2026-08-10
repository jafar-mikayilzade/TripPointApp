-- Feed post photos: moderation (pending until admin approves).

ALTER TABLE public.post_photos
  ADD COLUMN IF NOT EXISTS status text;

-- Existing feed photos stay visible
UPDATE public.post_photos
SET status = 'approved'
WHERE status IS NULL;

ALTER TABLE public.post_photos
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.post_photos
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'post_photos_status_check'
  ) THEN
    ALTER TABLE public.post_photos
      ADD CONSTRAINT post_photos_status_check
      CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]));
  END IF;
END $$;

ALTER TABLE public.post_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post photos are public" ON public.post_photos;
CREATE POLICY "post photos are public"
  ON public.post_photos
  FOR SELECT
  USING (
    status = 'approved'
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "users insert own post photos" ON public.post_photos;
CREATE POLICY "users insert own post photos"
  ON public.post_photos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM public.posts p
      WHERE p.id = post_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "users delete own post photos" ON public.post_photos;
CREATE POLICY "users delete own post photos"
  ON public.post_photos
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.posts p
      WHERE p.id = post_id
        AND p.user_id = auth.uid()
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "admins update post photos" ON public.post_photos;
CREATE POLICY "admins update post photos"
  ON public.post_photos
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, DELETE, UPDATE ON public.post_photos TO authenticated;
GRANT SELECT ON public.post_photos TO anon;

NOTIFY pgrst, 'reload schema';
