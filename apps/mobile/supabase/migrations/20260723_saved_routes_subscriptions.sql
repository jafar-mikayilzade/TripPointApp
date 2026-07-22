-- Saved routes (manual + AI) and subscriptions (tour / organizer)
-- In-app notifications for subscribers

create table if not exists public.saved_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source text not null check (source in ('manual', 'ai')),
  title text not null,
  summary text,
  region text,
  days_count int not null default 1,
  budget text,
  interests text[],
  group_type text,
  from_origin boolean not null default false,
  origin_lat double precision,
  origin_lng double precision,
  total_cost text,
  best_time text,
  travel jsonb,
  stops jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_routes_user_idx
  on public.saved_routes (user_id, created_at desc);

alter table public.saved_routes enable row level security;

drop policy if exists "saved_routes_select_own" on public.saved_routes;
create policy "saved_routes_select_own"
  on public.saved_routes for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "saved_routes_insert_own" on public.saved_routes;
create policy "saved_routes_insert_own"
  on public.saved_routes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "saved_routes_update_own" on public.saved_routes;
create policy "saved_routes_update_own"
  on public.saved_routes for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "saved_routes_delete_own" on public.saved_routes;
create policy "saved_routes_delete_own"
  on public.saved_routes for delete
  to authenticated
  using (auth.uid() = user_id);

-- Follow tour listing and/or organizer profile
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('listing', 'organizer')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);

create index if not exists subscriptions_user_idx
  on public.subscriptions (user_id, created_at desc);
create index if not exists subscriptions_target_idx
  on public.subscriptions (target_type, target_id);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "subscriptions_insert_own" on public.subscriptions;
create policy "subscriptions_insert_own"
  on public.subscriptions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "subscriptions_delete_own" on public.subscriptions;
create policy "subscriptions_delete_own"
  on public.subscriptions for delete
  to authenticated
  using (auth.uid() = user_id);

-- In-app notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (
    kind in ('tour_update', 'organizer_new_tour', 'tour_cancelled')
  ),
  title text not null,
  body text,
  listing_id uuid references public.listings (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Inserts from clients acting as organizers (notify their subscribers)
drop policy if exists "notifications_insert_authenticated" on public.notifications;
create policy "notifications_insert_authenticated"
  on public.notifications for insert
  to authenticated
  with check (true);

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own"
  on public.notifications for delete
  to authenticated
  using (auth.uid() = user_id);
