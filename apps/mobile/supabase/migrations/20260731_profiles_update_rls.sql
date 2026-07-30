-- profiles UPDATE RLS: owners may edit their own row, but never escalate.
-- Without this, any authenticated user could set role='admin' or is_verified.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Reading own protected columns inside a policy would recurse through RLS,
-- so expose them via SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.own_profile_guard()
RETURNS TABLE (role text, is_verified boolean, telegram_chat_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.role::text, p.is_verified, p.telegram_chat_id::text
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.own_profile_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.own_profile_guard() TO authenticated;

-- Replace every existing UPDATE policy: policies are OR-ed, so a leftover
-- permissive one would defeat the guard below.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "users update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role::text IS NOT DISTINCT FROM (SELECT g.role FROM public.own_profile_guard() g)
    AND is_verified IS NOT DISTINCT FROM (SELECT g.is_verified FROM public.own_profile_guard() g)
    AND telegram_chat_id::text
        IS NOT DISTINCT FROM (SELECT g.telegram_chat_id FROM public.own_profile_guard() g)
  );

CREATE POLICY "admins update profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

NOTIFY pgrst, 'reload schema';
