-- Fix feed posts visibility:
-- Feed posts visible to the poster + people who accepted their follow request
-- (i.e., if someone follows you and you accepted, you see THEIR feed posts)
drop policy if exists "Posts are viewable" on posts;

create policy "Posts are viewable"
  on posts for select using (
    moderation_status = 'approved'
    and (
      -- Own posts
      auth.uid() = user_id
      -- Peda posts: visible to all attendees
      or (peda_id is not null and exists (
        select 1 from peda_attendees where peda_id = posts.peda_id and user_id = auth.uid()
      ))
      -- Feed posts: visible to people who accepted the poster's follow request
      -- (poster follows me, I accepted => I see their feed posts)
      or (peda_id is null and exists (
        select 1 from follows
        where follower_id = posts.user_id
          and following_id = auth.uid()
          and status = 'accepted'
      ))
    )
  );
