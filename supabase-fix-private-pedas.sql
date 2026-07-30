-- Fix: private pedas visible to creator and attendees on the map
create or replace function nearby_pedas(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision default 10
)
returns table (
  id uuid,
  name text,
  address text,
  starts_at timestamptz,
  expires_at timestamptz,
  is_private boolean,
  attendee_count integer,
  created_by uuid,
  distance_km double precision,
  lat double precision,
  lng double precision
) as $$
begin
  return query
  select
    p.id,
    p.name,
    p.address,
    p.starts_at,
    p.expires_at,
    p.is_private,
    p.attendee_count,
    p.created_by,
    ST_Distance(
      p.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    ) / 1000.0 as distance_km,
    ST_Y(p.location::geometry) as lat,
    ST_X(p.location::geometry) as lng
  from pedas p
  where p.expires_at > now()
    and ST_DWithin(
      p.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      radius_km * 1000
    )
    and (
      not p.is_private
      or p.created_by = auth.uid()
      or exists (
        select 1 from peda_attendees pa
        where pa.peda_id = p.id and pa.user_id = auth.uid()
      )
    )
  order by distance_km asc;
end;
$$ language plpgsql security definer;
