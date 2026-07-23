-- Telegram user linking (bot account bind)
-- Admin notify uses env TELEGRAM_CHAT_ID; users store chat id on profiles.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS telegram_chat_id text,
  ADD COLUMN IF NOT EXISTS telegram_linked_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_telegram_chat_id_unique
  ON public.profiles (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
  code text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_link_codes_user_id_idx
  ON public.telegram_link_codes (user_id);

CREATE INDEX IF NOT EXISTS telegram_link_codes_expires_at_idx
  ON public.telegram_link_codes (expires_at);

ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_link_codes_select_own ON public.telegram_link_codes;
CREATE POLICY telegram_link_codes_select_own
  ON public.telegram_link_codes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS telegram_link_codes_insert_own ON public.telegram_link_codes;
CREATE POLICY telegram_link_codes_insert_own
  ON public.telegram_link_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS telegram_link_codes_delete_own ON public.telegram_link_codes;
CREATE POLICY telegram_link_codes_delete_own
  ON public.telegram_link_codes
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- telegram_chat_id is set only by API service role (webhook), not by clients.

NOTIFY pgrst, 'reload schema';
