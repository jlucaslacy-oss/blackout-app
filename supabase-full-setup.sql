-- ============================================================
-- LaPeda — Setup completo desde cero
-- Copia y pega TODO esto en Supabase SQL Editor
--
-- ANTES de correr esto:
-- Ve a Database > Extensions > busca "postgis" > Enable
-- ============================================================

-- 0. PostGIS
create extension if not exists postgis;

-- ============================================================
-- LIMPIAR TODO (si existe)
-- ============================================================

-- Tablas (cascade borra triggers, policies, indexes)
drop table if exists reports cascade;
drop table if exists posts cascade;
drop table if exists peda_attendees cascade;
drop table if exists pedas cascade;
drop table if exists follows cascade;
drop table if exists profiles cascade;

-- Funciones
drop function if exists handle_new_user() cascade;
drop function if exists update_attendee_count() cascade;
drop function if exists nearby_pedas(double precision, double precision, double precision) cascade;
drop function if exists join_peda_by_code(text) cascade;
drop function if exists react_to_post(uuid, text) cascade;
drop function if exists delete_user_account() cascade;

-- Policies de storage
drop policy if exists "Anyone can view post images" on storage.objects;
drop policy if exists "Authenticated users can upload images" on storage.objects;
drop policy if exists "Users can delete own images" on storage.objects;
drop policy if exists "Anyone can view peda media" on storage.objects;
drop policy if exists "Authenticated users can upload peda media" on storage.objects;
drop policy if exists "Users can delete own media" on storage.objects;

-- ============================================================
-- CREAR TABLAS (sin policies, para evitar dependencias circulares)
-- ============================================================

-- 1. Profiles
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  avatar_url text,
  bio text,
  phone text unique,
  birthdate date,
  pedas_attended integer default 0,
  blocked_users uuid[] default '{}',
  eula_accepted_at timestamptz,
  onboarding_completed boolean default false,
  push_token text,
  created_at timestamptz default now()
);

-- 2. Pedas
create table pedas (
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

create index pedas_location_idx on pedas using gist(location);
create index pedas_expires_at_idx on pedas(expires_at);
create index pedas_created_by_idx on pedas(created_by);

-- 3. Peda attendees
create table peda_attendees (
  peda_id uuid references pedas(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  joined_at timestamptz default now(),
  primary key (peda_id, user_id)
);

-- 4. Posts
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

-- 5. Reports
create table reports (
  id uuid default gen_random_uuid() primary key,
  reporter_id uuid references profiles(id) on delete cascade not null,
  target_type text not null check (target_type in ('post', 'peda', 'user')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'inappropriate', 'harassment', 'underage', 'other')),
  description text,
  status text default 'pending' check (status in ('pending', 'reviewed', 'actioned')),
  created_at timestamptz default now()
);

-- ============================================================
-- RLS + POLICIES (todas las tablas ya existen)
-- ============================================================

-- Profiles
alter table profiles enable row level security;

create policy "Public profiles are viewable by everyone"
  on profiles for select using (true);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

-- Pedas (ahora peda_attendees ya existe)
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

-- Peda attendees
alter table peda_attendees enable row level security;

create policy "Attendees are viewable"
  on peda_attendees for select using (true);

create policy "Authenticated users can join pedas"
  on peda_attendees for insert with check (auth.uid() = user_id);

create policy "Users can leave pedas"
  on peda_attendees for delete using (auth.uid() = user_id);

-- Posts
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

-- Reports
alter table reports enable row level security;

create policy "Users can create reports"
  on reports for insert with check (auth.uid() = reporter_id);

create policy "Users can view own reports"
  on reports for select using (auth.uid() = reporter_id);

-- ============================================================
-- TRIGGERS + FUNCTIONS
-- ============================================================

-- Auto-create profile on signup
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Auto-update attendee/peda counters
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

-- ============================================================
-- STORAGE
-- ============================================================

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

-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

-- Buscar pedas cercanas (PostGIS)
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

-- Unirse a peda con código
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

-- Reaccionar a un post
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

-- Eliminar cuenta
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
-- LISTO!
-- Ahora en el Dashboard de Supabase:
-- 1. Authentication > Providers > Phone > Enable
-- 2. Authentication > Providers > Apple > Enable
-- ============================================================
