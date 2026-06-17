-- ============================================================
-- LaPeda Migration: DrinkScore -> LaPeda
-- Run in Supabase SQL Editor AFTER enabling PostGIS extension
-- (Dashboard > Database > Extensions > postgis)
-- ============================================================

-- 0. Enable PostGIS
create extension if not exists postgis;

-- 1. Extend profiles table
alter table profiles
  add column if not exists phone text unique,
  add column if not exists birthdate date,
  add column if not exists pedas_attended integer default 0,
  add column if not exists blocked_users uuid[] default '{}',
  add column if not exists eula_accepted_at timestamptz,
  add column if not exists onboarding_completed boolean default false,
  add column if not exists push_token text;

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      nullif(split_part(new.email, '@', 1), ''),
      'user_' || substr(new.id::text, 1, 8)
    )
  );
  return new;
end;
$$ language plpgsql security definer;

-- 2. Pedas table
create table if not exists pedas (
  id uuid default gen_random_uuid() primary key,
  name text not null check (char_length(name) between 1 and 60),
  location geography(Point, 4326) not null,
  address text,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  is_private boolean default false,
  invite_code text unique,
  created_by uuid references profiles(id) on delete cascade not null,
  attendee_count integer default 0,
  created_at timestamptz default now()
);

create index if not exists pedas_location_idx on pedas using gist(location);
create index if not exists pedas_expires_at_idx on pedas(expires_at);
create index if not exists pedas_created_by_idx on pedas(created_by);

alter table pedas enable row level security;

create policy "Public active pedas are viewable"
  on pedas for select using (
    (not is_private) or
    (created_by = auth.uid()) or
    (exists (
      select 1 from peda_attendees
      where peda_attendees.peda_id = pedas.id
      and peda_attendees.user_id = auth.uid()
    ))
  );

create policy "Authenticated users can create pedas"
  on pedas for insert with check (auth.uid() = created_by);

create policy "Creators can update own pedas"
  on pedas for update using (auth.uid() = created_by);

create policy "Creators can delete own pedas"
  on pedas for delete using (auth.uid() = created_by);

-- 3. Peda attendees
create table if not exists peda_attendees (
  peda_id uuid references pedas(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  joined_at timestamptz default now(),
  primary key (peda_id, user_id)
);

alter table peda_attendees enable row level security;

create policy "Attendees are viewable"
  on peda_attendees for select using (true);

create policy "Authenticated users can join pedas"
  on peda_attendees for insert with check (auth.uid() = user_id);

create policy "Users can leave pedas"
  on peda_attendees for delete using (auth.uid() = user_id);

create or replace function update_attendee_count()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update pedas set attendee_count = attendee_count + 1 where id = new.peda_id;
    update profiles set pedas_attended = pedas_attended + 1 where id = new.user_id;
    return new;
  elsif TG_OP = 'DELETE' then
    update pedas set attendee_count = greatest(attendee_count - 1, 0) where id = old.peda_id;
    update profiles set pedas_attended = greatest(pedas_attended - 1, 0) where id = old.user_id;
    return old;
  end if;
end;
$$ language plpgsql security definer;

create trigger on_attendee_change
  after insert or delete on peda_attendees
  for each row execute function update_attendee_count();

-- 4. Posts table (new schema — drop old if exists)
drop table if exists posts cascade;

create table posts (
  id uuid default gen_random_uuid() primary key,
  peda_id uuid references pedas(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  media_url text not null,
  media_type text not null check (media_type in ('photo', 'video')),
  thumbnail_url text,
  moderation_status text default 'approved' check (moderation_status in ('pending', 'approved', 'rejected')),
  reactions_fire integer default 0,
  reactions_beer integer default 0,
  reactions_skull integer default 0,
  created_at timestamptz default now()
);

create index posts_peda_id_idx on posts(peda_id);
create index posts_user_id_idx on posts(user_id);
create index posts_created_at_idx on posts(created_at);

alter table posts enable row level security;

create policy "Approved posts are viewable"
  on posts for select using (
    moderation_status = 'approved' or user_id = auth.uid()
  );

create policy "Attendees can create posts"
  on posts for insert with check (
    auth.uid() = user_id and
    exists (
      select 1 from peda_attendees
      where peda_attendees.peda_id = posts.peda_id
      and peda_attendees.user_id = auth.uid()
    )
  );

create policy "Users can delete own posts"
  on posts for delete using (auth.uid() = user_id);

-- 5. Reports table
create table if not exists reports (
  id uuid default gen_random_uuid() primary key,
  reporter_id uuid references profiles(id) on delete cascade not null,
  target_type text not null check (target_type in ('post', 'peda', 'user')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'inappropriate', 'harassment', 'underage', 'other')),
  description text,
  status text default 'pending' check (status in ('pending', 'reviewed', 'actioned')),
  created_at timestamptz default now()
);

alter table reports enable row level security;

create policy "Users can create reports"
  on reports for insert with check (auth.uid() = reporter_id);

create policy "Users can view own reports"
  on reports for select using (auth.uid() = reporter_id);

-- 6. Drop follows table (no longer used)
drop table if exists follows cascade;

-- 7. Storage bucket for peda media
insert into storage.buckets (id, name, public)
values ('peda-media', 'peda-media', true)
on conflict (id) do nothing;

create policy "Anyone can view peda media"
  on storage.objects for select using (bucket_id = 'peda-media');

create policy "Authenticated users can upload peda media"
  on storage.objects for insert with check (
    bucket_id = 'peda-media' and auth.role() = 'authenticated'
  );

create policy "Users can delete own media"
  on storage.objects for delete using (
    bucket_id = 'peda-media' and auth.uid()::text = (storage.foldername(name))[1]
  );

-- 8. RPC: Find nearby pedas (PostGIS)
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
    and not p.is_private
    and ST_DWithin(
      p.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      radius_km * 1000
    )
  order by distance_km asc;
end;
$$ language plpgsql security definer;

-- 9. RPC: Join peda by invite code
create or replace function join_peda_by_code(code text)
returns uuid as $$
declare
  peda_uuid uuid;
begin
  select p.id into peda_uuid
  from pedas p
  where p.invite_code = code and p.expires_at > now();

  if peda_uuid is null then
    raise exception 'Peda no encontrada o expirada';
  end if;

  insert into peda_attendees (peda_id, user_id)
  values (peda_uuid, auth.uid())
  on conflict do nothing;

  return peda_uuid;
end;
$$ language plpgsql security definer;

-- 10. RPC: React to a post
create or replace function react_to_post(
  post_uuid uuid,
  reaction_type text
)
returns void as $$
begin
  if reaction_type = 'fire' then
    update posts set reactions_fire = reactions_fire + 1 where id = post_uuid;
  elsif reaction_type = 'beer' then
    update posts set reactions_beer = reactions_beer + 1 where id = post_uuid;
  elsif reaction_type = 'skull' then
    update posts set reactions_skull = reactions_skull + 1 where id = post_uuid;
  else
    raise exception 'Tipo de reacción inválido';
  end if;
end;
$$ language plpgsql security definer;

-- 11. RPC: Delete user account
create or replace function delete_user_account()
returns void as $$
begin
  delete from storage.objects
  where bucket_id = 'peda-media'
    and (storage.foldername(name))[1] = auth.uid()::text;

  delete from profiles where id = auth.uid();
end;
$$ language plpgsql security definer;

-- ============================================================
-- MANUAL STEPS (do in Supabase Dashboard):
-- 1. Enable PostGIS: Database > Extensions > postgis
-- 2. Enable Phone Auth: Authentication > Providers > Phone
-- 3. Enable Apple Auth: Authentication > Providers > Apple
-- 4. Optional: Enable pg_cron for auto-cleanup:
--    select cron.schedule('cleanup-expired', '*/15 * * * *', $$
--      delete from pedas where expires_at < now();
--    $$);
-- ============================================================
