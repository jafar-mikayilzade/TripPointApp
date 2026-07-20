-- 1) listing_pois: public SELECT + owner INSERT (tours/carpool routes visible)
-- 2) cancel_listing / update_listing_admin: SECURITY DEFINER so admin soft-delete
--    works even when UPDATE...RETURNING SELECT policies are missing/misconfigured
-- 3) set_listing_route_pois / get_listing_route_poi_names for reliable route save/load
-- 4) Ensure listings grants + admin/owner UPDATE policies

-- ─── listing_pois RLS ────────────────────────────────────
ALTER TABLE public.listing_pois ENABLE ROW LEVEL SECURITY;

-- App və RPC sort_order gözləyir; bəzi DB-lərdə sütun yoxdur
ALTER TABLE public.listing_pois
  ADD COLUMN IF NOT EXISTS sort_order integer;

ALTER TABLE public.listing_pois
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

DROP POLICY IF EXISTS "listing_pois are public" ON public.listing_pois;
DROP POLICY IF EXISTS "listing_pois public select" ON public.listing_pois;
CREATE POLICY "listing_pois public select"
  ON public.listing_pois
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "listing owners insert pois" ON public.listing_pois;
CREATE POLICY "listing owners insert pois"
  ON public.listing_pois
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.id = listing_id
        AND l.created_by = auth.uid()
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "listing owners delete pois" ON public.listing_pois;
CREATE POLICY "listing owners delete pois"
  ON public.listing_pois
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.id = listing_id
        AND l.created_by = auth.uid()
    )
    OR public.is_admin()
  );

GRANT SELECT, INSERT, DELETE ON public.listing_pois TO authenticated;
GRANT SELECT ON public.listing_pois TO anon;

-- ─── listings grants + policies ──────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.listings TO authenticated;
GRANT SELECT ON public.listings TO anon;

DROP POLICY IF EXISTS "admins select all listings" ON public.listings;
CREATE POLICY "admins select all listings"
  ON public.listings
  FOR SELECT
  USING (public.is_admin());

-- INSERT ... RETURNING və sahibin öz elanını görməsi üçün
DROP POLICY IF EXISTS "users select own listings" ON public.listings;
CREATE POLICY "users select own listings"
  ON public.listings
  FOR SELECT
  USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "active listings are public" ON public.listings;
CREATE POLICY "active listings are public"
  ON public.listings
  FOR SELECT
  USING (status = 'active');

DROP POLICY IF EXISTS "owners update own listings" ON public.listings;
CREATE POLICY "owners update own listings"
  ON public.listings
  FOR UPDATE
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "admins update all listings" ON public.listings;
CREATE POLICY "admins update all listings"
  ON public.listings
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─── Soft-delete via RPC (owner or admin) ────────────────
CREATE OR REPLACE FUNCTION public.cancel_listing(p_listing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.listings l
    WHERE l.id = p_listing_id
      AND (l.created_by = auth.uid() OR public.is_admin())
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.listings
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = p_listing_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_listing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_listing(uuid) TO authenticated;

-- ─── Admin patch listing via RPC ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_listing(
  p_listing_id uuid,
  p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_price numeric DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_spots_left integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.listings
  SET
    title = COALESCE(p_title, title),
    description = COALESCE(p_description, description),
    status = COALESCE(p_status, status),
    price = COALESCE(p_price, price),
    contact_phone = COALESCE(p_contact_phone, contact_phone),
    spots_left = COALESCE(p_spots_left, spots_left),
    updated_at = now()
  WHERE id = p_listing_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_listing(uuid, text, text, text, numeric, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_listing(uuid, text, text, text, numeric, text, integer) TO authenticated;

-- ─── Route POIs: reliable write ──────────────────────────
CREATE OR REPLACE FUNCTION public.set_listing_route_pois(
  p_listing_id uuid,
  p_poi_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.listings l
    WHERE l.id = p_listing_id
      AND (l.created_by = auth.uid() OR public.is_admin())
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.listing_pois WHERE listing_id = p_listing_id;

  IF p_poi_ids IS NULL OR coalesce(array_length(p_poi_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.listing_pois (listing_id, poi_id, sort_order)
  SELECT p_listing_id, x.poi_id, x.ord::integer
  FROM unnest(p_poi_ids) WITH ORDINALITY AS x(poi_id, ord);
END;
$$;

REVOKE ALL ON FUNCTION public.set_listing_route_pois(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_listing_route_pois(uuid, uuid[]) TO authenticated;

-- ─── Route POIs: reliable read (names in order) ──────────
CREATE OR REPLACE FUNCTION public.get_listing_route_poi_names(p_listing_id uuid)
RETURNS TABLE (name text, sort_order integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.name::text, lp.sort_order
  FROM public.listing_pois lp
  JOIN public.pois p ON p.id = lp.poi_id
  WHERE lp.listing_id = p_listing_id
  ORDER BY lp.sort_order NULLS LAST, p.name;
$$;

REVOKE ALL ON FUNCTION public.get_listing_route_poi_names(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_listing_route_poi_names(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_listing_route_poi_names(uuid) TO anon;

NOTIFY pgrst, 'reload schema';
