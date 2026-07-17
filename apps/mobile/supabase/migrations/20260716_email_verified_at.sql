-- App-səviyyəli email təsdiqi (Google OAuth auth.email_confirmed_at-ı avtomatik doldurur)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Mövcud istifadəçilər bloklanmasın
UPDATE public.profiles
SET email_verified_at = COALESCE(email_verified_at, created_at, now())
WHERE email_verified_at IS NULL;

NOTIFY pgrst, 'reload schema';
