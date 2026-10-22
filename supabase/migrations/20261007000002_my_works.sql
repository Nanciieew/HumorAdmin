begin;

-- Generated images keep the same caption before and after publication.
create table public.work_captions (
  work_id uuid primary key,
  contributor_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 100),
  description text not null default '' check (char_length(description) <= 1000)
);
alter table public.work_captions enable row level security;
revoke all on public.work_captions from anon, authenticated;
grant all on public.work_captions to service_role;
grant select, insert on public.work_captions to authenticated;
grant update (title, description) on public.work_captions to authenticated;
create policy "Read own captions" on public.work_captions for select to authenticated
using (contributor_id = (select auth.uid()));
create policy "Add captions to own completed works" on public.work_captions for insert to authenticated
with check (
  contributor_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and onboarding_completed_at is not null)
  and (exists (select 1 from public.generated_images g where g.id = work_id and g.contributor_id = (select auth.uid()))
    or exists (select 1 from public.gallery_photos p where p.id = work_id and p.source = 'upload' and p.contributor_id = (select auth.uid())))
);
create policy "Edit own captions" on public.work_captions for update to authenticated
using (contributor_id = (select auth.uid()) and exists (select 1 from public.profiles where id = (select auth.uid()) and onboarding_completed_at is not null))
with check (contributor_id = (select auth.uid()));

create function public.save_work_caption(p_work_id uuid, p_title text, p_description text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Log in to edit your work' using errcode = '42501'; end if;
  insert into public.work_captions(work_id, contributor_id, title, description)
  values (p_work_id, auth.uid(), btrim(p_title), btrim(p_description))
  on conflict (work_id) do update set title = excluded.title, description = excluded.description;
end;
$$;
revoke all on function public.save_work_caption(uuid, text, text) from public;
grant execute on function public.save_work_caption(uuid, text, text) to authenticated;

create view public.my_works with (security_invoker = true) as
select g.id as work_id, g.contributor_id, 'generated'::text as source,
  g.created_at, g.storage_path, 'generated-images'::text as bucket,
  p.id as photo_id, coalesce(c.title, '') as title, coalesce(c.description, '') as description
from public.generated_images g
left join public.gallery_photos p on p.generation_id = g.id
left join public.work_captions c on c.work_id = g.id
where g.contributor_id = (select auth.uid())
union all
select p.id, p.contributor_id, p.source, p.published_at, p.storage_path,
  'gallery-photos'::text, p.id, coalesce(c.title, ''), coalesce(c.description, '')
from public.gallery_photos p left join public.work_captions c on c.work_id = p.id
where p.source = 'upload' and p.contributor_id = (select auth.uid());
revoke all on public.my_works from public, anon, authenticated;
grant select on public.my_works to authenticated;

-- Public captions are returned only for published photos.
create or replace function public.gallery_feed(p_sort text default 'top', p_cursor jsonb default null, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 60));
  v_as_of timestamptz := coalesce((p_cursor->>'as_of')::timestamptz, now());
  v_week timestamptz := date_trunc('week', now() at time zone 'America/New_York') at time zone 'America/New_York';
  v_end timestamptz := (date_trunc('week', now() at time zone 'America/New_York') + interval '1 week') at time zone 'America/New_York';
  v_result jsonb;
begin
  if p_sort not in ('top', 'week', 'newest') then raise exception 'Invalid gallery sort'; end if;
  if p_cursor is not null and (p_cursor->>'sort' is distinct from p_sort or
    not (p_cursor ?& array['id','published_at','score','as_of'])) then raise exception 'Invalid gallery cursor'; end if;
  with ranked as (
    select p.id, p.storage_path, p.published_at, p.source,
      coalesce(c.title, '') as title, coalesce(c.description, '') as description,
      concat_ws(' ', nullif(trim(u.first_name), ''), nullif(trim(u.last_name), '')) as contributor_name,
      t.upvotes, case when p_sort = 'newest' then 0 else t.upvotes end as score
    from public.gallery_photos p join public.profiles u on u.id = p.contributor_id
    join public.gallery_vote_totals t on t.photo_id = p.id
    left join public.work_captions c on c.work_id = coalesce(p.generation_id, p.id)
    where p.published_at <= v_as_of
      and (p_sort <> 'week' or (p.published_at >= v_week and p.published_at < v_end))
  ), batch as (
    select * from ranked where p_cursor is null or
      (score, published_at, id) < ((p_cursor->>'score')::bigint, (p_cursor->>'published_at')::timestamptz, (p_cursor->>'id')::uuid)
    order by score desc, published_at desc, id desc limit v_limit + 1
  ), page as (select * from batch order by score desc, published_at desc, id desc limit v_limit)
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page) - 'score' order by score desc, published_at desc, id desc) from page), '[]'::jsonb),
    'next_cursor', case when (select count(*) from batch) > v_limit then (
      select jsonb_build_object('sort', p_sort, 'score', score, 'published_at', published_at, 'id', id, 'as_of', v_as_of)
      from page order by score, published_at, id limit 1
    ) else null end
  ) into v_result;
  return v_result;
end;
$$;
commit;
