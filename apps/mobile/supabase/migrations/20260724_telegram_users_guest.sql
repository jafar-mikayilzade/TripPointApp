-- Guest Telegram users (app optional). Service role / webhook only.

CREATE TABLE IF NOT EXISTS public.telegram_users (
  telegram_chat_id text PRIMARY KEY,
  linked_user_id uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
  username text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_users_linked_user_id_idx
  ON public.telegram_users (linked_user_id)
  WHERE linked_user_id IS NOT NULL;

ALTER TABLE public.telegram_users ENABLE ROW LEVEL SECURITY;

-- No client policies: only service role (API webhook) reads/writes.
-- Authenticated users can see if THEIR profile is linked (optional read).
DROP POLICY IF EXISTS telegram_users_select_own_link ON public.telegram_users;
CREATE POLICY telegram_users_select_own_link
  ON public.telegram_users
  FOR SELECT
  TO authenticated
  USING (linked_user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
