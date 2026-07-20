-- Listings: admin SELECT (required for UPDATE ... RETURNING) + owner UPDATE

-- Soft-delete/edit use UPDATE + .select(). Without SELECT policy, PostgREST
-- returns no rows → app shows "İcazə yoxdur" even when is_admin() is true.

DROP POLICY IF EXISTS "admins select all listings" ON public.listings;
CREATE POLICY "admins select all listings"
  ON public.listings
  FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "owners update own listings" ON public.listings;
CREATE POLICY "owners update own listings"
  ON public.listings
  FOR UPDATE
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Keep / re-assert admin update (soft delete + edit)
DROP POLICY IF EXISTS "admins update all listings" ON public.listings;
CREATE POLICY "admins update all listings"
  ON public.listings
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

NOTIFY pgrst, 'reload schema';
