-- Link saved route → published tour listing (hide "Tur kimi paylaş" when set)
alter table public.saved_routes
  add column if not exists listing_id uuid references public.listings (id) on delete set null;

create index if not exists saved_routes_listing_idx
  on public.saved_routes (listing_id)
  where listing_id is not null;
