-- Delete posts from expired pedas automatically
-- Run this in Supabase SQL Editor

-- Enable pg_cron if not already enabled
create extension if not exists pg_cron;

-- Function to delete posts from expired pedas
create or replace function cleanup_expired_peda_posts()
returns void
language plpgsql
security definer
as $$
begin
  delete from posts
  where peda_id is not null
    and peda_id in (
      select id from pedas where expires_at < now()
    );
end;
$$;

-- Run cleanup every hour
select cron.schedule(
  'cleanup-expired-peda-posts',
  '0 * * * *',
  $$select cleanup_expired_peda_posts()$$
);
