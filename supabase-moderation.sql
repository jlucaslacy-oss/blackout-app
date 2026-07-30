-- Image moderation: auto-hide posts with 3+ reports, admin functions

-- Auto-reject posts that get 3 or more reports
create or replace function check_report_threshold()
returns trigger as $$
declare
  report_count int;
begin
  if new.target_type = 'post' then
    select count(*) into report_count
    from reports
    where target_type = 'post' and target_id = new.target_id;

    if report_count >= 3 then
      update posts set moderation_status = 'rejected' where id = new.target_id::uuid;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_report_check_threshold on reports;
create trigger on_report_check_threshold
  after insert on reports
  for each row
  execute function check_report_threshold();

-- Admin: view all reported posts with report counts
create or replace view reported_posts as
select
  p.id as post_id,
  p.media_url,
  p.caption,
  p.moderation_status,
  p.created_at,
  pr.username as author,
  count(r.id) as report_count,
  array_agg(distinct r.reason) as reasons
from posts p
join reports r on r.target_type = 'post' and r.target_id::uuid = p.id
join profiles pr on pr.id = p.user_id
group by p.id, pr.username
order by report_count desc;

-- Admin function: approve or reject a post
create or replace function moderate_post(post_id uuid, new_status text)
returns void as $$
begin
  if new_status not in ('approved', 'rejected') then
    raise exception 'Invalid status. Use approved or rejected.';
  end if;
  update posts set moderation_status = new_status where id = post_id;
end;
$$ language plpgsql security definer;
