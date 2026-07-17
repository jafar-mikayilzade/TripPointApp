-- Admin approved POI əlavə edə bilsin (mövcud INSERT yalnız pending icazə verir)

DROP POLICY IF EXISTS "admins insert pois" ON public.pois;
CREATE POLICY "admins insert pois"
  ON public.pois
  FOR INSERT
  WITH CHECK (public.is_admin());

NOTIFY pgrst, 'reload schema';
