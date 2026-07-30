-- Notifications table
create table if not exists notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  actor_id uuid references profiles(id) on delete cascade not null,
  type text check (type in ('follow_request', 'follow_accepted', 'like', 'comment')) not null,
  post_id uuid references posts(id) on delete cascade,
  comment_text text,
  read boolean default false,
  created_at timestamptz default now()
);

create index idx_notifications_user on notifications(user_id, created_at desc);

-- RLS
alter table notifications enable row level security;

create policy "Users can read own notifications"
  on notifications for select using (auth.uid() = user_id);

create policy "Authenticated users can insert notifications"
  on notifications for insert with check (auth.uid() = actor_id);

create policy "Users can update own notifications"
  on notifications for update using (auth.uid() = user_id);

-- Add to realtime
alter publication supabase_realtime add table notifications;
