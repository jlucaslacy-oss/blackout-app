-- Add blur preview data to posts
alter table posts add column if not exists blur_data text;
