-- Fix delete_user_account to fully delete all user data (Apple requirement)
create or replace function delete_user_account()
returns void as $$
begin
  -- Delete user's storage objects from all buckets
  delete from storage.objects
  where bucket_id = 'peda-media'
    and (storage.foldername(name))[1] = auth.uid()::text;

  delete from storage.objects
  where bucket_id = 'feed-media'
    and (storage.foldername(name))[1] = auth.uid()::text;

  delete from storage.objects
  where bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text;

  -- Delete user's social data
  delete from comments where user_id = auth.uid();
  delete from likes where user_id = auth.uid();
  delete from follows where follower_id = auth.uid() or following_id = auth.uid();
  delete from reports where reporter_id = auth.uid();

  -- Delete user's posts
  delete from posts where user_id = auth.uid();

  -- Delete peda attendance
  delete from peda_attendees where user_id = auth.uid();

  -- Delete pedas created by user
  delete from pedas where created_by = auth.uid();

  -- Delete profile (cascade handles remaining refs)
  delete from profiles where id = auth.uid();

  -- Delete auth user record
  delete from auth.users where id = auth.uid();
end;
$$ language plpgsql security definer;
