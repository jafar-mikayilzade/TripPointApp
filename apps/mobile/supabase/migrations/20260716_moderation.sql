-- Moderasiya: şəkil pending, elan şikayətləri, admin hüquqları

-- ─── Helpers ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;

-- ─── poi_photos.status ──────────────────────────────────
ALTER TABLE public.poi_photos
  ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE public.poi_photos
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Mövcud şəkillər artıq canlıdır → approved
UPDATE public.poi_photos
SET status = 'approved'
WHERE status IS NULL;

ALTER TABLE public.poi_photos
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.poi_photos
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poi_photos_status_check'
  ) THEN
    ALTER TABLE public.poi_photos
      ADD CONSTRAINT poi_photos_status_check
      CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]));
  END IF;
END $$;

-- Public yalnız approved görür; admin və yükləyən hamısını görür
DROP POLICY IF EXISTS "poi photos are public" ON public.poi_photos;
DROP POLICY IF EXISTS "approved poi photos are public" ON public.poi_photos;
CREATE POLICY "approved poi photos are public"
  ON public.poi_photos
  FOR SELECT
  USING (
    status = 'approved'
    OR public.is_admin()
    OR uploaded_by = auth.uid()
  );

DROP POLICY IF EXISTS "admins update poi photos" ON public.poi_photos;
CREATE POLICY "admins update poi photos"
  ON public.poi_photos
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admins delete poi photos" ON public.poi_photos;
CREATE POLICY "admins delete poi photos"
  ON public.poi_photos
  FOR DELETE
  USING (public.is_admin());

-- ─── pois: admin + own pending görünüşü ─────────────────
DROP POLICY IF EXISTS "users see own submitted pois" ON public.pois;
CREATE POLICY "users see own submitted pois"
  ON public.pois
  FOR SELECT
  USING (submitted_by = auth.uid());

DROP POLICY IF EXISTS "admins select all pois" ON public.pois;
CREATE POLICY "admins select all pois"
  ON public.pois
  FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "admins update all pois" ON public.pois;
CREATE POLICY "admins update all pois"
  ON public.pois
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admins delete pois" ON public.pois;
CREATE POLICY "admins delete pois"
  ON public.pois
  FOR DELETE
  USING (public.is_admin());

-- ─── listings: admin update/delete soft via update ──────
DROP POLICY IF EXISTS "admins update all listings" ON public.listings;
CREATE POLICY "admins update all listings"
  ON public.listings
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─── listing_reports ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.listing_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status = ANY (ARRAY['open'::text, 'reviewed'::text, 'dismissed'::text, 'actioned'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_reports_unique_reporter UNIQUE (listing_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS listing_reports_status_idx
  ON public.listing_reports (status, created_at DESC);

ALTER TABLE public.listing_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users insert own listing reports" ON public.listing_reports;
CREATE POLICY "users insert own listing reports"
  ON public.listing_reports
  FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "users see own listing reports" ON public.listing_reports;
CREATE POLICY "users see own listing reports"
  ON public.listing_reports
  FOR SELECT
  USING (auth.uid() = reporter_id OR public.is_admin());

DROP POLICY IF EXISTS "admins update listing reports" ON public.listing_reports;
CREATE POLICY "admins update listing reports"
  ON public.listing_reports
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

NOTIFY pgrst, 'reload schema';
