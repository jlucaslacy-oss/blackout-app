-- ============================================================
-- Blackout v2 Migration
-- Run in Supabase SQL Editor AFTER the initial setup
-- ============================================================

-- ============================================================
-- 1. FOLLOWS (private accounts, request-based)
-- ============================================================
create table follows (
  id uuid default gen_random_uuid() primary key,
  follower_id uuid references profiles(id) on delete cascade not null,
  following_id uuid references profiles(id) on delete cascade not null,
  status text check (status in ('pending', 'accepted', 'declined')) not null default 'pending',
  created_at timestamptz default now(),
  unique (follower_id, following_id)
);

alter table follows enable row level security;

create policy "Users can see own follows"
  on follows for select using (
    auth.uid() = follower_id or auth.uid() = following_id
  );

create policy "Users can request to follow"
  on follows for insert with check (auth.uid() = follower_id);

create policy "Users can update follows directed at them"
  on follows for update using (auth.uid() = following_id);

create policy "Users can unfollow"
  on follows for delete using (auth.uid() = follower_id or auth.uid() = following_id);

create index follows_follower_idx on follows (follower_id);
create index follows_following_idx on follows (following_id);
create index follows_status_idx on follows (status);

-- ============================================================
-- 2. UPDATE POSTS (add feed support, likes/comments counts)
-- ============================================================
alter table posts alter column peda_id drop not null;
alter table posts add column caption text;
alter table posts add column like_count integer default 0;
alter table posts add column comment_count integer default 0;

-- Drop old reaction columns
alter table posts drop column if exists reactions_fire;
alter table posts drop column if exists reactions_beer;
alter table posts drop column if exists reactions_skull;

-- Update posts RLS: feed posts visible to accepted followers
drop policy if exists "Approved posts are viewable" on posts;

create policy "Posts are viewable"
  on posts for select using (
    moderation_status = 'approved'
    and (
      -- Own posts
      auth.uid() = user_id
      -- Peda posts: visible to attendees
      or (peda_id is not null and exists (
        select 1 from peda_attendees where peda_id = posts.peda_id and user_id = auth.uid()
      ))
      -- Feed posts: visible to accepted followers
      or (peda_id is null and exists (
        select 1 from follows where follower_id = auth.uid() and following_id = posts.user_id and status = 'accepted'
      ))
    )
  );

-- Update insert policy: allow feed posts (no peda required)
drop policy if exists "Attendees can create posts" on posts;

create policy "Users can create posts"
  on posts for insert with check (
    auth.uid() = user_id
    and (
      peda_id is null
      or exists (
        select 1 from peda_attendees where peda_id = posts.peda_id and user_id = auth.uid()
      )
    )
  );

-- ============================================================
-- 3. LIKES
-- ============================================================
create table likes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  post_id uuid references posts(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique (user_id, post_id)
);

alter table likes enable row level security;

create policy "Likes are viewable by everyone"
  on likes for select using (true);

create policy "Users can like"
  on likes for insert with check (auth.uid() = user_id);

create policy "Users can unlike"
  on likes for delete using (auth.uid() = user_id);

create index likes_post_idx on likes (post_id);
create index likes_user_idx on likes (user_id);

-- Auto-update like count
create or replace function update_like_count()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update posts set like_count = like_count + 1 where id = NEW.post_id;
  elsif TG_OP = 'DELETE' then
    update posts set like_count = like_count - 1 where id = OLD.post_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger on_like_change
  after insert or delete on likes
  for each row execute function update_like_count();

-- ============================================================
-- 4. COMMENTS
-- ============================================================
create table comments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  post_id uuid references posts(id) on delete cascade not null,
  text text not null,
  created_at timestamptz default now()
);

alter table comments enable row level security;

create policy "Comments are viewable by everyone"
  on comments for select using (true);

create policy "Users can comment"
  on comments for insert with check (auth.uid() = user_id);

create policy "Users can delete own comments"
  on comments for delete using (auth.uid() = user_id);

create index comments_post_idx on comments (post_id);

-- Auto-update comment count
create or replace function update_comment_count()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    update posts set comment_count = comment_count + 1 where id = NEW.post_id;
  elsif TG_OP = 'DELETE' then
    update posts set comment_count = comment_count - 1 where id = OLD.post_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger on_comment_change
  after insert or delete on comments
  for each row execute function update_comment_count();

-- ============================================================
-- 5. UPDATE PEDAS POLICY (allow viewing past pedas for attendees)
-- ============================================================
drop policy if exists "Active pedas are viewable by everyone" on pedas;

create policy "Pedas are viewable"
  on pedas for select using (
    -- Active pedas visible to everyone
    expires_at > now()
    -- Past pedas visible to attendees
    or exists (
      select 1 from peda_attendees where peda_id = pedas.id and user_id = auth.uid()
    )
    -- Own pedas always visible
    or auth.uid() = created_by
  );

-- ============================================================
-- 6. FOLLOWER COUNT ON PROFILES
-- ============================================================
alter table profiles add column if not exists follower_count integer default 0;
alter table profiles add column if not exists following_count integer default 0;

create or replace function update_follow_counts()
returns trigger as $$
begin
  if TG_OP = 'INSERT' and NEW.status = 'accepted' then
    update profiles set follower_count = follower_count + 1 where id = NEW.following_id;
    update profiles set following_count = following_count + 1 where id = NEW.follower_id;
  elsif TG_OP = 'DELETE' and OLD.status = 'accepted' then
    update profiles set follower_count = follower_count - 1 where id = OLD.following_id;
    update profiles set following_count = following_count - 1 where id = OLD.follower_id;
  elsif TG_OP = 'UPDATE' and OLD.status != 'accepted' and NEW.status = 'accepted' then
    update profiles set follower_count = follower_count + 1 where id = NEW.following_id;
    update profiles set following_count = following_count + 1 where id = NEW.follower_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

create trigger on_follow_change
  after insert or update or delete on follows
  for each row execute function update_follow_counts();

-- ============================================================
-- 7. NEW RPC: TOGGLE LIKE
-- ============================================================
create or replace function toggle_like(target_post_id uuid)
returns boolean as $$
declare
  existing_like uuid;
begin
  select id into existing_like from likes where user_id = auth.uid() and post_id = target_post_id;
  if existing_like is not null then
    delete from likes where id = existing_like;
    return false;
  else
    insert into likes (user_id, post_id) values (auth.uid(), target_post_id);
    return true;
  end if;
end;
$$ language plpgsql security definer;

-- Drop old react_to_post function
drop function if exists react_to_post(uuid, text);

-- ============================================================
-- 8. STORAGE: FEED MEDIA BUCKET
-- ============================================================
insert into storage.buckets (id, name, public) values ('feed-media', 'feed-media', true)
on conflict (id) do nothing;

create policy "Anyone can view feed media"
  on storage.objects for select using (bucket_id = 'feed-media');

create policy "Authenticated users can upload feed media"
  on storage.objects for insert with check (
    bucket_id = 'feed-media' and auth.role() = 'authenticated'
  );

create policy "Users can delete own feed media"
  on storage.objects for delete using (
    bucket_id = 'feed-media' and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- 9. REALTIME for comments
-- ============================================================
alter publication supabase_realtime add table comments;
alter publication supabase_realtime add table follows;
