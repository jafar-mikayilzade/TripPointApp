-- profiles.email: unique, auth.users-dən doldurulur (email + Google)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

-- Mövcud sətirləri auth.users-dən doldur
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND (p.email IS NULL OR p.email = '')
  AND u.email IS NOT NULL;

-- Boş email-ləri NULL et (unique index üçün)
UPDATE public.profiles
SET email = NULL
WHERE email IS NOT NULL AND TRIM(email) = '';

-- Unique (bir neçə NULL ola bilər; eyni email təkrar olmaz)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL;

-- Signup / Google trigger — email də yazılsın
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, role)
  VALUES (
    NEW.id,
    NULLIF(LOWER(TRIM(NEW.email)), ''),
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')), ''),
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture')), ''),
    'user'
  )
  ON CONFLICT (id) DO UPDATE
    SET
      email = COALESCE(EXCLUDED.email, public.profiles.email),
      full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
      avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Auth-da olub profili olmayanlar
INSERT INTO public.profiles (id, email, full_name, avatar_url, role)
SELECT
  u.id,
  NULLIF(LOWER(TRIM(u.email)), ''),
  NULLIF(TRIM(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')), ''),
  NULLIF(TRIM(COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')), ''),
  'user'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
