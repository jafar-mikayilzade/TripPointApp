-- Rejection reason + listing owner may update join-request rows.

alter table public.listing_participants
  add column if not exists rejection_reason text default null;

drop policy if exists "listing_owner_update_participants" on public.listing_participants;

create policy "listing_owner_update_participants"
  on public.listing_participants
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.listings l
      where l.id = listing_participants.listing_id
        and l.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.listings l
      where l.id = listing_participants.listing_id
        and l.created_by = auth.uid()
    )
  );
