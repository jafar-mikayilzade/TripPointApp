-- pois cədvəlini app sxeminə uyğunlaşdır (lat/lng, uuid, approved, region lowercase)
-- Mövcud Quba/Baku məlumatlarını saxla.

-- 1) Köhnə datanı müvəqqəti saxla
CREATE TABLE IF NOT EXISTS public._pois_legacy_backup AS
SELECT * FROM public.pois;

-- 2) poi_photos FK-ni (place_id → pois.place_id) götür
ALTER TABLE public.poi_photos
  DROP CONSTRAINT IF EXISTS poi_photos_place_id_fkey;

ALTER TABLE public.poi_photos
  DROP CONSTRAINT IF EXISTS poi_photos_poi_id_fkey;

-- 3) listing_pois / digər FK-lər
ALTER TABLE public.listing_pois
  DROP CONSTRAINT IF EXISTS listing_pois_poi_id_fkey;

ALTER TABLE public.travel_history
  DROP CONSTRAINT IF EXISTS travel_history_poi_id_fkey;

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_poi_id_fkey;

-- 4) Köhnə pois-u dəyişdir
DROP TABLE IF EXISTS public.pois CASCADE;

CREATE TABLE public.pois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'other',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  region text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  address text,
  phone text,
  website text,
  place_id text UNIQUE,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pois_region_idx ON public.pois (lower(region));
CREATE INDEX IF NOT EXISTS pois_status_idx ON public.pois (status);
CREATE INDEX IF NOT EXISTS pois_category_idx ON public.pois (category);

-- 5) Legacy məlumatı köçür
INSERT INTO public.pois (
  name, category, status, region, lat, lng, address, place_id, website, created_at
)
SELECT
  b.name,
  CASE lower(COALESCE(b.category, ''))
    WHEN 'restaurant' THEN 'restaurant'
    WHEN 'cafe' THEN 'cafe'
    WHEN 'hotel' THEN 'hotel'
    WHEN 'hostel' THEN 'hostel'
    WHEN 'tourist_attraction' THEN 'historical'
    WHEN 'museum' THEN 'historical'
    WHEN 'park' THEN 'nature'
    ELSE 'other'
  END,
  CASE lower(COALESCE(b.status, ''))
    WHEN 'approved' THEN 'approved'
    WHEN 'pending' THEN 'pending'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'active' THEN 'approved'
    ELSE 'approved'
  END,
  lower(trim(b.region)),
  b.latitude,
  b.longitude,
  b.address,
  NULLIF(b.place_id, ''),
  CASE
    WHEN b.place_id IS NOT NULL AND b.place_id <> ''
      THEN 'https://www.google.com/maps/place/?q=place_id:' || b.place_id
    ELSE NULL
  END,
  COALESCE(b.created_at, now())
FROM public._pois_legacy_backup b
WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL;

-- 6) poi_photos: poi_id UUID FK bərpa
-- Əgər place_id ilə uyğunluq varsa bağla
UPDATE public.poi_photos ph
SET poi_id = p.id
FROM public.pois p
WHERE ph.place_id IS NOT NULL
  AND p.place_id IS NOT NULL
  AND ph.place_id = p.place_id;

-- Orphan foto-ları sil (uuid FK pozmasın)
DELETE FROM public.poi_photos ph
WHERE NOT EXISTS (SELECT 1 FROM public.pois p WHERE p.id = ph.poi_id);

ALTER TABLE public.poi_photos
  ADD CONSTRAINT poi_photos_poi_id_fkey
  FOREIGN KEY (poi_id) REFERENCES public.pois(id) ON DELETE CASCADE;

-- 7) Digər FK-lər
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='listing_pois' AND column_name='poi_id'
  ) THEN
    ALTER TABLE public.listing_pois
      ADD CONSTRAINT listing_pois_poi_id_fkey
      FOREIGN KEY (poi_id) REFERENCES public.pois(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.travel_history
    ADD CONSTRAINT travel_history_poi_id_fkey
    FOREIGN KEY (poi_id) REFERENCES public.pois(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.posts
    ADD CONSTRAINT posts_poi_id_fkey
    FOREIGN KEY (poi_id) REFERENCES public.pois(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
WHEN undefined_column THEN NULL;
END $$;

-- 8) RLS
ALTER TABLE public.pois ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approved pois are public" ON public.pois;
CREATE POLICY "approved pois are public"
  ON public.pois FOR SELECT
  USING (status = 'approved' OR submitted_by = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "users see own submitted pois" ON public.pois;
CREATE POLICY "users see own submitted pois"
  ON public.pois FOR SELECT
  USING (submitted_by = auth.uid());

DROP POLICY IF EXISTS "authenticated users submit pois" ON public.pois;
CREATE POLICY "authenticated users submit pois"
  ON public.pois FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = submitted_by AND status = 'pending');

DROP POLICY IF EXISTS "admins insert pois" ON public.pois;
CREATE POLICY "admins insert pois"
  ON public.pois FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admins update all pois" ON public.pois;
CREATE POLICY "admins update all pois"
  ON public.pois FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admins delete pois" ON public.pois;
CREATE POLICY "admins delete pois"
  ON public.pois FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admins select all pois" ON public.pois;
CREATE POLICY "admins select all pois"
  ON public.pois FOR SELECT TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.pois TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pois TO authenticated;

NOTIFY pgrst, 'reload schema';
