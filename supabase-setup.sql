-- ============================================================
-- Blackout — Supabase Schema
-- Run this in the SQL Editor of your Supabase project
-- ============================================================

-- Enable PostGIS for location features
create extension if not exists postgis with schema extensions;

-- ============================================================
-- 1. PROFILES
-- ============================================================
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  avatar_url text,
  bio text,
  phone text,
  birthdate date,
  pedas_attended integer default 0,
  blocked_users uuid[] default '{}',
  eula_accepted_at timestamptz,
  onboarding_completed boolean default false,
  push_token text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Public profiles are viewable by everyone"
  on profiles for select using (true);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

-- Auto-create profile on signup (works for phone + Apple auth)
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, phone)
  values (
    new.id,
    coalesce(
      split_part(new.email, '@', 1),
      'user_' || substr(new.id::text, 1, 8)
    ),
    new.phone
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- 2. PEDAS (parties)
-- ============================================================
create table pedas (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  location geography(Point, 4326) not null,
  address text,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  is_private boolean default false,
  invite_code text,
  created_by uuid references profiles(id) on delete cascade not null,
  attendee_count integer default 0,
  created_at timestamptz default now()
);

alter table pedas enable row level security;

create policy "Active pedas are viewable by everyone"
  on pedas for select using (expires_at > now());

create policy "Users can create pedas"
  on pedas for insert with check (auth.uid() = created_by);

create policy "Creators can update own pedas"
  on pedas for update using (auth.uid() = created_by);

-- Spatial index for nearby queries
create index pedas_location_idx on pedas using gist (location);
create index pedas_expires_at_idx on pedas (expires_at);

-- ============================================================
-- 3. PEDA ATTENDEES
-- ============================================================
create table peda_attendees (
  peda_id uuid references pedas(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  joined_at timestamptz default now(),
  primary key (peda_id, user_id)
);

alter table peda_attendees enable row level security;

create policy "Attendees are viewable by everyone"
  on peda_attendees for select using (true);

create policy "Users can join pedas"
  on peda_attendees for insert with check (auth.uid() = user_id);

create policy "Users can leave pedas"
  on peda_attendees for delete using (auth.uid() = user_id);

-- Auto-update attendee count
create or replace function update_attendee_count()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update pedas set attendee_count = attendee_count + 1 where id = NEW.peda_id;
    update profiles set pedas_attended = pedas_attended + 1 where id = NEW.user_id;
  elsif TG_OP = 'DELETE' then
    update pedas set attendee_count = attendee_count - 1 where id = OLD.peda_id;
    update profiles set pedas_attended = pedas_attended - 1 where id = OLD.user_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger on_attendee_change
  after insert or delete on peda_attendees
  for each row execute function update_attendee_count();

-- ============================================================
-- 4. POSTS (photos/videos in a peda)
-- ============================================================
create table posts (
  id uuid default gen_random_uuid() primary key,
  peda_id uuid references pedas(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  media_url text not null,
  media_type text check (media_type in ('photo', 'video')) not null default 'photo',
  thumbnail_url text,
  moderation_status text check (moderation_status in ('pending', 'approved', 'rejected')) not null default 'approved',
  reactions_fire integer default 0,
  reactions_beer integer default 0,
  reactions_skull integer default 0,
  created_at timestamptz default now()
);

alter table posts enable row level security;

create policy "Approved posts are viewable"
  on posts for select using (moderation_status = 'approved');

create policy "Attendees can create posts"
  on posts for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from peda_attendees where peda_id = posts.peda_id and user_id = auth.uid()
    )
  );

create policy "Users can delete own posts"
  on posts for delete using (auth.uid() = user_id);

create index posts_peda_id_idx on posts (peda_id);

-- ============================================================
-- 5. REPORTS
-- ============================================================
create table reports (
  id uuid default gen_random_uuid() primary key,
  reporter_id uuid references profiles(id) on delete cascade not null,
  target_type text check (target_type in ('post', 'peda', 'user')) not null,
  target_id uuid not null,
  reason text check (reason in ('spam', 'inappropriate', 'harassment', 'underage', 'other')) not null,
  description text,
  status text check (status in ('pending', 'reviewed', 'actioned')) not null default 'pending',
  created_at timestamptz default now()
);

alter table reports enable row level security;

create policy "Users can create reports"
  on reports for insert with check (auth.uid() = reporter_id);

-- ============================================================
-- 6. RPC FUNCTIONS
-- ============================================================

-- Nearby pedas (used by the map screen)
create or replace function nearby_pedas(user_lat float, user_lng float, radius_km float default 10)
returns table (
  id uuid,
  name text,
  address text,
  starts_at timestamptz,
  expires_at timestamptz,
  is_private boolean,
  attendee_count integer,
  created_by uuid,
  distance_km float,
  lat float,
  lng float
) as $$
  select
    p.id,
    p.name,
    p.address,
    p.starts_at,
    p.expires_at,
    p.is_private,
    p.attendee_count,
    p.created_by,
    round((st_distance(p.location, st_point(user_lng, user_lat)::geography) / 1000)::numeric, 2)::float as distance_km,
    st_y(p.location::geometry) as lat,
    st_x(p.location::geometry) as lng
  from pedas p
  where p.expires_at > now()
    and st_dwithin(p.location, st_point(user_lng, user_lat)::geography, radius_km * 1000)
  order by distance_km;
$$ language sql security definer;

-- React to a post
create or replace function react_to_post(post_uuid uuid, reaction_type text)
returns void as $$
begin
  if reaction_type = 'fire' then
    update posts set reactions_fire = reactions_fire + 1 where id = post_uuid;
  elsif reaction_type = 'beer' then
    update posts set reactions_beer = reactions_beer + 1 where id = post_uuid;
  elsif reaction_type = 'skull' then
    update posts set reactions_skull = reactions_skull + 1 where id = post_uuid;
  end if;
end;
$$ language plpgsql security definer;

-- Delete user account (called from profile screen)
create or replace function delete_user_account()
returns void as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$ language plpgsql security definer;

-- ============================================================
-- 7. STORAGE BUCKET
-- ============================================================
insert into storage.buckets (id, name, public) values ('peda-media', 'peda-media', true);

create policy "Anyone can view peda media"
  on storage.objects for select using (bucket_id = 'peda-media');

create policy "Authenticated users can upload media"
  on storage.objects for insert with check (
    bucket_id = 'peda-media' and auth.role() = 'authenticated'
  );

create policy "Users can delete own media"
  on storage.objects for delete using (
    bucket_id = 'peda-media' and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- 8. REALTIME (enable for live updates in peda view)
-- ============================================================
alter publication supabase_realtime add table posts;
