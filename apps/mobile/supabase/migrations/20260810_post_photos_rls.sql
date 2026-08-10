-- Feed post photos: public read + owner insert (RLS-safe).

ALTER TABLE public.post_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post photos are public" ON public.post_photos;
CREATE POLICY "post photos are public"
  ON public.post_photos
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "users insert own post photos" ON public.post_photos;
CREATE POLICY "users insert own post photos"
  ON public.post_photos
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
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

GRANT SELECT, INSERT, DELETE ON public.post_photos TO authenticated;
GRANT SELECT ON public.post_photos TO anon;

NOTIFY pgrst, 'reload schema';
