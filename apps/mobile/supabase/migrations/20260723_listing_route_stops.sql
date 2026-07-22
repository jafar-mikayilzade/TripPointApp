-- Store full tour/carpool route stops (app POIs + map/custom places)
alter table public.listings
  add column if not exists route_stops jsonb not null default '[]'::jsonb;

comment on column public.listings.route_stops is
  'Ordered route stops: [{name, lat, lng, poi_id?, source?}]. Includes map places not in pois.';
