-- Listing owners can see who subscribed to their tours (listing target only).

drop policy if exists "subscriptions_select_as_listing_owner" on public.subscriptions;
create policy "subscriptions_select_as_listing_owner"
  on public.subscriptions
  for select
  to authenticated
  using (
    target_type = 'listing'
    and exists (
      select 1
      from public.listings l
      where l.id = target_id
        and l.created_by = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
