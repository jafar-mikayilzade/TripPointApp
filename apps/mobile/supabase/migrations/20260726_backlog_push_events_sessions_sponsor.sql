-- Backlog: push token, app_events, bot_sessions, sponsored POI, verified profile

-- 1) Push
alter table public.profiles
  add column if not exists expo_push_token text;

comment on column public.profiles.expo_push_token is
  'Expo push token (Android-first); null = no push';

-- 2) Verified badge (trust, unpaid)
alter table public.profiles
  add column if not exists is_verified boolean not null default false;

alter table public.profiles
  add column if not exists verified_at timestamptz;

-- 3) Product events
create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_events_name_created_idx
  on public.app_events (name, created_at desc);

create index if not exists app_events_user_created_idx
  on public.app_events (user_id, created_at desc);

alter table public.app_events enable row level security;

drop policy if exists app_events_insert_own on public.app_events;
create policy app_events_insert_own
  on public.app_events
  for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());

drop policy if exists app_events_select_own on public.app_events;
create policy app_events_select_own
  on public.app_events
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 4) Telegram bot sessions (stateless workers)
create table if not exists public.bot_sessions (
  chat_id text primary key,
  state text not null default '',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bot_sessions enable row level security;
-- No client policies — service role only (API)

-- 5) Sponsored POI
alter table public.pois
  add column if not exists is_sponsored boolean not null default false;

alter table public.pois
  add column if not exists sponsor_until timestamptz;

comment on column public.pois.is_sponsored is
  'Featured/sponsored listing on home map/list';
comment on column public.pois.sponsor_until is
  'Sponsorship expires at; null = no expiry while is_sponsored';

notify pgrst, 'reload schema';
