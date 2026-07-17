-- İstifadəçi öz hesabını tam silə bilər (auth.users + cascade + storage).
-- Eyni email ilə yenidən qeydiyyat mümkündür.

DROP FUNCTION IF EXISTS public.delete_own_account();

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = 'P0001',
            HINT = 'JWT / sessiya yoxdur';
  END IF;

  -- Bu istifadəçiyə verilmiş reytinqlər (FK yoxdur)
  DELETE FROM public.ratings
  WHERE target_type = 'user'
    AND target_id = uid;

  -- storage.protect_delete trigger-i birbaşa DELETE-i bloklayır;
  -- Storage API əvəzinə session flag ilə icazə veririk.
  PERFORM set_config('storage.allow_delete_query', 'true', true);

  DELETE FROM storage.objects
  WHERE owner = uid
     OR owner_id = uid::text
     OR name LIKE (uid::text || '/%');

  -- auth.users → profiles CASCADE → elanlar, səyahətlər, postlar və s.
  DELETE FROM auth.users
  WHERE id = uid;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    RAISE EXCEPTION 'auth_delete_failed'
      USING ERRCODE = 'P0001',
            HINT = 'auth.users silinmədi';
  END IF;

  RETURN json_build_object('ok', true, 'user_id', uid);
END;
$$;

ALTER FUNCTION public.delete_own_account() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO service_role;

NOTIFY pgrst, 'reload schema';
