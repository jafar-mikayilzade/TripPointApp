-- Hesab silmə: auth.users + identities + storage + public data tam təmizlənir.
-- Eyni email ilə yenidən qeydiyyat mümkün olsun.

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage, extensions
AS $$
DECLARE
  uid uuid := auth.uid();
  v_email text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = 'P0001',
            HINT = 'JWT / sessiya yoxdur';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = uid;

  IF v_email IS NULL AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = 'P0001',
            HINT = 'auth.users tapılmadı';
  END IF;

  -- ─── Public data (CASCADE-ə etibar etmədən əvvəl təmizlə) ───
  DELETE FROM public.ratings
  WHERE rater_id = uid
     OR (target_type IN ('user', 'profile', 'business') AND target_id = uid);

  UPDATE public.pois
  SET submitted_by = NULL
  WHERE submitted_by = uid;

  UPDATE public.poi_photos
  SET uploaded_by = NULL
  WHERE uploaded_by = uid;

  DELETE FROM public.listing_reports WHERE reporter_id = uid;
  DELETE FROM public.listing_participants WHERE user_id = uid;
  DELETE FROM public.posts WHERE user_id = uid;
  DELETE FROM public.travel_history WHERE user_id = uid;

  -- expense: əvvəl üzvlük və ödənişlər, sonra qruplar
  DELETE FROM public.expense_group_members WHERE user_id = uid;
  DELETE FROM public.expenses WHERE paid_by = uid;
  DELETE FROM public.expense_groups WHERE created_by = uid;

  DELETE FROM public.listings WHERE created_by = uid;
  DELETE FROM public.businesses WHERE owner_id = uid;

  -- ─── Storage: protect_delete allow=true olsa belə RETURN NULL ilə silməni ləğv edir ───
  PERFORM set_config('storage.allow_delete_query', 'true', true);

  BEGIN
    ALTER TABLE storage.objects DISABLE TRIGGER protect_objects_delete;
  EXCEPTION
    WHEN insufficient_privilege OR OTHERS THEN
      NULL; -- trigger disable alınmasa belə davam et
  END;

  BEGIN
    DELETE FROM storage.objects
    WHERE owner = uid
       OR owner_id = uid::text
       OR name LIKE (uid::text || '/%')
       OR name LIKE ('%' || uid::text || '%');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'storage delete: %', SQLERRM;
  END;

  BEGIN
    ALTER TABLE storage.objects ENABLE TRIGGER protect_objects_delete;
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  -- ─── Auth: əvvəl identities/sessions, sonra users ───
  DELETE FROM auth.identities WHERE user_id = uid;
  DELETE FROM auth.sessions WHERE user_id = uid;
  DELETE FROM auth.mfa_factors WHERE user_id = uid;
  DELETE FROM auth.one_time_tokens WHERE user_id = uid;

  BEGIN
    DELETE FROM auth.refresh_tokens WHERE user_id = uid::text OR user_id = uid;
  EXCEPTION
    WHEN undefined_table OR undefined_column OR OTHERS THEN
      NULL;
  END;

  DELETE FROM public.profiles WHERE id = uid;

  DELETE FROM auth.users WHERE id = uid;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = uid) THEN
    RAISE EXCEPTION 'auth_delete_failed'
      USING ERRCODE = 'P0001',
            HINT = 'auth.users silinmədi';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = uid) THEN
    RAISE EXCEPTION 'profile_delete_failed'
      USING ERRCODE = 'P0001',
            HINT = 'profiles silinmədi';
  END IF;

  RETURN json_build_object(
    'ok', true,
    'user_id', uid,
    'email', v_email
  );
END;
$$;

ALTER FUNCTION public.delete_own_account() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO service_role;

-- Orphan auth users (profile yoxdur) — köhnə natamam silmələrdən qalıq
DELETE FROM auth.identities
WHERE user_id IN (
  SELECT u.id
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p.id IS NULL
);

DELETE FROM auth.sessions
WHERE user_id IN (
  SELECT u.id
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p.id IS NULL
);

DELETE FROM auth.users
WHERE id IN (
  SELECT u.id
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p.id IS NULL
);

NOTIFY pgrst, 'reload schema';
