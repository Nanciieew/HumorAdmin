begin;

-- Apply with affected app writes paused. Locks make the backfill and FK switch atomic.
lock table public.generated_images, public.gallery_photos, public.work_captions,
  public.gallery_uploads, public.photo_votes in access exclusive mode;

do $$
begin
  if exists (select 1 from public.gallery_photos where source = 'generated' and id <> generation_id) then
    raise exception 'Generation/publication IDs differ; resolve their mapping before consolidation';
  end if;
  if exists (select 1 from public.generated_images g join public.gallery_photos p on p.id = g.id
    where p.source <> 'generated' or p.contributor_id <> g.contributor_id) then
    raise exception 'Image ID collision or owner mismatch';
  end if;
  if exists (select 1 from public.work_captions c where not (
    exists (select 1 from public.generated_images g where g.id = c.work_id and g.contributor_id = c.contributor_id)
    or exists (select 1 from public.gallery_photos p where p.id = c.work_id and p.source = 'upload' and p.contributor_id = c.contributor_id))) then
    raise exception 'Orphaned or owner-mismatched caption; resolve before consolidation';
  end if;
end;
$$;

create table public.images (
  id uuid primary key default gen_random_uuid(),
  contributor_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('upload', 'generated')),
  private_storage_path text unique,
  public_storage_path text unique,
  title text not null default '' check (char_length(title) <= 100),
  description text not null default '' check (char_length(description) <= 1000),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  check ((published_at is null) = (public_storage_path is null)),
  check ((source = 'generated' and private_storage_path is not null)
    or (source = 'upload' and private_storage_path is null and published_at is not null)),
  check (private_storage_path is null or split_part(private_storage_path, '/', 1) = contributor_id::text),
  check (public_storage_path is null or split_part(public_storage_path, '/', 1) = contributor_id::text)
);
create index images_owner_created on public.images(contributor_id, created_at desc, id desc);
create index images_gallery_created on public.images(created_at desc, id desc) where published_at is not null;
create index images_gallery_published on public.images(published_at) where published_at is not null;

insert into public.images(id, contributor_id, source, private_storage_path, public_storage_path, title, description, created_at, published_at)
select g.id, g.contributor_id, 'generated', g.storage_path, p.storage_path,
  coalesce(c.title, ''), coalesce(c.description, ''), g.created_at, p.published_at
from public.generated_images g left join public.gallery_photos p on p.generation_id = g.id
left join public.work_captions c on c.work_id = g.id
union all
select p.id, p.contributor_id, 'upload', null, p.storage_path,
  coalesce(c.title, ''), coalesce(c.description, ''), coalesce(t.created_at, p.published_at), p.published_at
from public.gallery_photos p left join public.work_captions c on c.work_id = p.id
left join public.gallery_uploads t on t.id = p.id and t.contributor_id = p.contributor_id
where p.source = 'upload';

alter table public.images enable row level security;
revoke all on public.images from public, anon, authenticated;
grant all on public.images to service_role;
grant select on public.images to authenticated;
grant update(title, description) on public.images to authenticated;
create policy "Read own images" on public.images for select to authenticated
using (contributor_id = (select auth.uid()));
create policy "Edit own image captions" on public.images for update to authenticated
using (contributor_id = (select auth.uid()) and exists (
  select 1 from public.profiles where id = (select auth.uid()) and onboarding_completed_at is not null))
with check (contributor_id = (select auth.uid()));

alter table public.photo_votes drop constraint photo_votes_photo_id_fkey;
alter table public.photo_votes add constraint photo_votes_photo_id_fkey
  foreign key (photo_id) references public.images(id) on delete cascade;

-- Enforce published targets even for direct writes; no public SELECT grant on images is needed.
create function public.require_published_vote_target()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.images where id = new.photo_id and published_at is not null) then
    raise exception 'Votes require a published image' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.require_published_vote_target() from public, anon, authenticated;
create trigger require_published_vote_target before insert or update on public.photo_votes
for each row execute function public.require_published_vote_target();

create or replace view public.gallery_vote_totals as
select p.id as photo_id,
  count(v.voter_id) filter (where v.value = 1) as upvotes,
  count(v.voter_id) filter (where v.value = -1) as downvotes
from public.images p left join public.photo_votes v on v.photo_id = p.id
where p.published_at is not null group by p.id;

create or replace view public.my_works with (security_invoker = true) as
select id as work_id, contributor_id, source, created_at,
  case when source = 'generated' then private_storage_path else public_storage_path end as storage_path,
  case when source = 'generated' then 'generated-images' else 'gallery-photos' end as bucket,
  case when published_at is not null then id end as photo_id, title, description
from public.images where contributor_id = (select auth.uid());

create or replace function public.save_work_caption(p_work_id uuid, p_title text, p_description text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and onboarding_completed_at is not null) then
    raise exception 'Finish signup before editing' using errcode = '42501';
  end if;
  update public.images set title = btrim(p_title), description = btrim(p_description)
  where id = p_work_id and contributor_id = auth.uid();
  if not found then raise exception 'Work not found' using errcode = '42501'; end if;
end;
$$;

create or replace function public.gallery_feed(p_sort text default 'top', p_cursor jsonb default null, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 60));
  v_as_of timestamptz := coalesce((p_cursor->>'as_of')::timestamptz, now());
  v_week timestamptz := date_trunc('week', now() at time zone 'America/New_York') at time zone 'America/New_York';
  v_end timestamptz := (date_trunc('week', now() at time zone 'America/New_York') + interval '1 week') at time zone 'America/New_York';
  v_result jsonb;
begin
  if p_sort is null or p_sort not in ('top', 'week', 'newest') then raise exception 'Invalid gallery sort'; end if;
  if p_cursor is not null and (p_cursor->>'sort' is distinct from p_sort or
    not (p_cursor ?& array['id','created_at','score','as_of']) or
    p_cursor->>'id' is null or p_cursor->>'created_at' is null or p_cursor->>'score' is null or p_cursor->>'as_of' is null) then
    raise exception 'Invalid gallery cursor; refresh the gallery';
  end if;
  with ranked as (
    select p.id, p.public_storage_path as storage_path, p.created_at, p.published_at, p.source, p.title, p.description,
      concat_ws(' ', nullif(trim(u.first_name), ''), nullif(trim(u.last_name), '')) as contributor_name,
      t.upvotes, case when p_sort = 'newest' then 0 else t.upvotes end as score
    from public.images p join public.profiles u on u.id = p.contributor_id
    join public.gallery_vote_totals t on t.photo_id = p.id
    where p.published_at <= v_as_of
      and (p_sort <> 'week' or (p.published_at >= v_week and p.published_at < v_end))
  ), batch as (
    select * from ranked where p_cursor is null or
      (score, created_at, id) < ((p_cursor->>'score')::bigint, (p_cursor->>'created_at')::timestamptz, (p_cursor->>'id')::uuid)
    order by score desc, created_at desc, id desc limit v_limit + 1
  ), page as (select * from batch order by score desc, created_at desc, id desc limit v_limit)
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg((to_jsonb(page) - 'score') || jsonb_build_object('created_at',
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
      order by score desc, created_at desc, id desc) from page), '[]'::jsonb),
    'next_cursor', case when (select count(*) from batch) > v_limit then (
      select jsonb_build_object('sort', p_sort, 'score', score, 'created_at', created_at, 'id', id, 'as_of', v_as_of)
      from page order by score, created_at, id limit 1
    ) else null end
  ) into v_result;
  return v_result;
end;
$$;

-- Retain restricted legacy rows for rollback; retire them in a later migration.
revoke all on public.generated_images, public.gallery_photos, public.work_captions from public, anon, authenticated, service_role;
grant select on public.generated_images, public.gallery_photos, public.work_captions to service_role;
commit;
