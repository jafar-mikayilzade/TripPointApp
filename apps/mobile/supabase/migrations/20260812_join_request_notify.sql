-- join_request notification kind + rejection_reason on listing_participants
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

-- Store organizer's rejection reason on the participant row
alter table public.listing_participants
  add column if not exists rejection_reason text default null;
