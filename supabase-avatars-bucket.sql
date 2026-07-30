-- Create avatars storage bucket
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);

-- Allow authenticated users to upload their own avatar
create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- Allow authenticated users to update their own avatar
create policy "Users can update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- Allow anyone to view avatars
create policy "Avatars are publicly viewable"
  on storage.objects for select
  using (bucket_id = 'avatars');
