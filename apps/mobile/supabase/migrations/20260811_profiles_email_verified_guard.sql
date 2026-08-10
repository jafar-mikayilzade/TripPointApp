-- Prevent clients from faking email_verified_at unless Auth already confirmed email.

CREATE OR REPLACE FUNCTION public.profiles_block_email_verified_bypass()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at THEN
    IF public.is_admin() THEN
      RETURN NEW;
    END IF;
    -- Legitimate path: Supabase Auth already confirmed this account's email
    IF NEW.id = auth.uid()
       AND EXISTS (
         SELECT 1
         FROM auth.users u
         WHERE u.id = auth.uid()
           AND u.email_confirmed_at IS NOT NULL
       ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'email_verified_at cannot be set without Auth email confirmation';
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW.email_verified_at IS NOT NULL
     AND NOT public.is_admin() THEN
    IF NEW.id = auth.uid()
       AND EXISTS (
         SELECT 1
         FROM auth.users u
         WHERE u.id = auth.uid()
           AND u.email_confirmed_at IS NOT NULL
       ) THEN
      RETURN NEW;
    END IF;
    NEW.email_verified_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_block_email_verified_bypass ON public.profiles;
CREATE TRIGGER profiles_block_email_verified_bypass
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_block_email_verified_bypass();

NOTIFY pgrst, 'reload schema';
