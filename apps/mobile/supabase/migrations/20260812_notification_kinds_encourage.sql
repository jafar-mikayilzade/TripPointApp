-- Expand in-app notification kinds for encouragement / system tips
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
      'system_tip'
    )
  );
