-- Harden notifications INSERT: only as actor, only to your subscribers (or admin).
-- Replaces open with check (true) from 20260723_saved_routes_subscriptions.sql

drop policy if exists "notifications_insert_authenticated" on public.notifications;
drop policy if exists "notifications_insert_as_actor_to_subscribers" on public.notifications;

create policy "notifications_insert_as_actor_to_subscribers"
  on public.notifications for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and (
      -- Recipient follows this actor as organizer
      exists (
        select 1
        from public.subscriptions s
        where s.user_id = notifications.user_id
          and s.target_type = 'organizer'
          and s.target_id = auth.uid()
      )
      or
      -- Recipient subscribed to a listing this actor owns (or admin acting)
      exists (
        select 1
        from public.subscriptions s
        join public.listings l on l.id = s.target_id
        where s.user_id = notifications.user_id
          and s.target_type = 'listing'
          and (notifications.listing_id is null or notifications.listing_id = s.target_id)
          and (l.created_by = auth.uid() or public.is_admin())
      )
    )
  );
