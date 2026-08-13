-- Allow join-request / listing-owner / participant notifications (not only subscribers).
-- Enable realtime so the recipient's open app sees the row immediately.

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (
    kind in (
      'tour_update',
      'organizer_new_tour',
      'tour_cancelled',
      'weather_tip',
      'explore_region',
      'system_tip',
      'join_request'
    )
  );

drop policy if exists "notifications_insert_as_actor_to_subscribers" on public.notifications;
drop policy if exists "notifications_insert_as_actor" on public.notifications;

create policy "notifications_insert_as_actor"
  on public.notifications for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and user_id <> auth.uid()
    and (
      exists (
        select 1
        from public.subscriptions s
        where s.user_id = notifications.user_id
          and s.target_type = 'organizer'
          and s.target_id = auth.uid()
      )
      or exists (
        select 1
        from public.subscriptions s
        where s.user_id = auth.uid()
          and s.target_type = 'organizer'
          and s.target_id = notifications.user_id
      )
      or exists (
        select 1
        from public.subscriptions s
        join public.listings l on l.id = s.target_id
        where s.user_id = notifications.user_id
          and s.target_type = 'listing'
          and (notifications.listing_id is null or notifications.listing_id = s.target_id)
          and (l.created_by = auth.uid() or public.is_admin())
      )
      or exists (
        select 1
        from public.listings l
        where l.id = notifications.listing_id
          and (
            l.created_by = notifications.user_id
            or l.created_by = auth.uid()
          )
      )
      or exists (
        select 1
        from public.listing_participants p
        where p.listing_id = notifications.listing_id
          and (
            (p.user_id = auth.uid() and notifications.user_id <> auth.uid())
            or (p.user_id = notifications.user_id)
          )
      )
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end
$$;
