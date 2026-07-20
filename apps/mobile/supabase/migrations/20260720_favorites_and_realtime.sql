-- Favorites / bookmarks for POIs and listings
-- Cost-efficient: one table, RLS, unique per user+target

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('poi', 'listing')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);

create index if not exists favorites_user_idx on public.favorites (user_id, created_at desc);
create index if not exists favorites_target_idx on public.favorites (target_type, target_id);

alter table public.favorites enable row level security;

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own"
  on public.favorites for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own"
  on public.favorites for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own"
  on public.favorites for delete
  to authenticated
  using (auth.uid() = user_id);

-- Realtime: ensure listing_participants is in publication (safe if already added)
do $$
begin
  alter publication supabase_realtime add table public.listing_participants;
exception
  when duplicate_object then null;
end $$;
