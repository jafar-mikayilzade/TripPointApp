-- Photo variants (thumb/medium) + optional Google opening hours text

alter table public.poi_photos
  add column if not exists thumb_url text;

alter table public.poi_photos
  add column if not exists medium_url text;

comment on column public.poi_photos.thumb_url is
  'Kiçik variant (~150px) — kart/siyahı';
comment on column public.poi_photos.medium_url is
  'Orta variant (~800px) — detal qalereya';
comment on column public.poi_photos.photo_url is
  'Original sıxılmış — tam ekran';

alter table public.pois
  add column if not exists opening_hours text;

comment on column public.pois.opening_hours is
  'Google Place Details weekday_text və ya qısa mətn';
