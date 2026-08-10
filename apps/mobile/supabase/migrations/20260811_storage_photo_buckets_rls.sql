-- Storage RLS for photo buckets: path must start with auth.uid()/

-- Ensure buckets exist (idempotent if already created in dashboard)
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('poi-photos', 'poi-photos', true),
  ('post-photos', 'post-photos', true),
  ('travel-photos', 'travel-photos', true)
ON CONFLICT (id) DO NOTHING;

-- poi-photos
DROP POLICY IF EXISTS "poi photos public read" ON storage.objects;
CREATE POLICY "poi photos public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'poi-photos');

DROP POLICY IF EXISTS "poi photos owner insert" ON storage.objects;
CREATE POLICY "poi photos owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'poi-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "poi photos owner update" ON storage.objects;
CREATE POLICY "poi photos owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'poi-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'poi-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "poi photos owner delete" ON storage.objects;
CREATE POLICY "poi photos owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'poi-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- post-photos
DROP POLICY IF EXISTS "post photos public read" ON storage.objects;
CREATE POLICY "post photos public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'post-photos');

DROP POLICY IF EXISTS "post photos owner insert" ON storage.objects;
CREATE POLICY "post photos owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'post-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "post photos owner update" ON storage.objects;
CREATE POLICY "post photos owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'post-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'post-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "post photos owner delete" ON storage.objects;
CREATE POLICY "post photos owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'post-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- travel-photos
DROP POLICY IF EXISTS "travel photos public read" ON storage.objects;
CREATE POLICY "travel photos public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'travel-photos');

DROP POLICY IF EXISTS "travel photos owner insert" ON storage.objects;
CREATE POLICY "travel photos owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'travel-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "travel photos owner update" ON storage.objects;
CREATE POLICY "travel photos owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'travel-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'travel-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "travel photos owner delete" ON storage.objects;
CREATE POLICY "travel photos owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'travel-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
