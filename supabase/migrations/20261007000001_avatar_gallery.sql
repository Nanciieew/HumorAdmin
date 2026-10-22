begin;

create table public.generated_images (
  id uuid primary key default gen_random_uuid(),
  contributor_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = contributor_id::text)
);
create table public.gallery_uploads (
  id uuid primary key default gen_random_uuid(),
  contributor_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = contributor_id::text)
);
create index gallery_uploads_cleanup on public.gallery_uploads(created_at);
create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  contributor_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  source text not null check (source in ('upload', 'generated')),
  generation_id uuid unique references public.generated_images(id),
  published_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = contributor_id::text),
  check ((source = 'generated') = (generation_id is not null))
);
create index gallery_photos_newest on public.gallery_photos(published_at desc, id desc);
create table public.photo_votes (
  photo_id uuid not null references public.gallery_photos(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  value smallint not null check (value in (1, -1)),
  primary key (photo_id, voter_id)
);
create index photo_votes_voter on public.photo_votes(voter_id);

alter table public.generated_images enable row level security;
alter table public.gallery_uploads enable row level security;
alter table public.gallery_photos enable row level security;
alter table public.photo_votes enable row level security;
revoke all on public.generated_images, public.gallery_uploads, public.gallery_photos, public.photo_votes from anon, authenticated;
grant all on public.generated_images, public.gallery_uploads, public.gallery_photos, public.photo_votes to service_role;
grant select on public.gallery_photos to anon, authenticated;
grant select on public.generated_images to authenticated;
grant select, insert, delete on public.photo_votes to authenticated;
grant update (value) on public.photo_votes to authenticated;

create policy "Public gallery photos" on public.gallery_photos for select to anon, authenticated using (true);
create policy "Own generated images" on public.generated_images for select to authenticated using (contributor_id = (select auth.uid()));
create policy "Read own votes" on public.photo_votes for select to authenticated using (voter_id = (select auth.uid()));
create policy "Completed users insert own vote" on public.photo_votes for insert to authenticated with check (
  voter_id = (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.onboarding_completed_at is not null
  )
);
create policy "Completed users change own vote" on public.photo_votes for update to authenticated
using (voter_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.onboarding_completed_at is not null))
with check (voter_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.onboarding_completed_at is not null));
create policy "Completed users remove own vote" on public.photo_votes for delete to authenticated
using (voter_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.onboarding_completed_at is not null));

-- Only administrators can query both totals. Public functions expose upvotes only.
create view public.gallery_vote_totals as
select p.id as photo_id,
  count(v.voter_id) filter (where v.value = 1) as upvotes,
  count(v.voter_id) filter (where v.value = -1) as downvotes
from public.gallery_photos p left join public.photo_votes v on v.photo_id = p.id group by p.id;
revoke all on public.gallery_vote_totals from public, anon, authenticated;
grant select on public.gallery_vote_totals to service_role;

create function public.gallery_photo_score(p_photo_id uuid)
returns table (id uuid, upvotes bigint)
language sql stable security definer set search_path = '' as $$
  select photo_id, upvotes from public.gallery_vote_totals where photo_id = p_photo_id;
$$;
revoke all on function public.gallery_photo_score(uuid) from public;
grant execute on function public.gallery_photo_score(uuid) to anon, authenticated, service_role;

create function public.gallery_feed(p_sort text default 'top', p_cursor jsonb default null, p_limit integer default 30)
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
      concat_ws(' ', nullif(trim(u.first_name), ''), nullif(trim(u.last_name), '')) as contributor_name,
      t.upvotes, case when p_sort = 'newest' then 0 else t.upvotes end as score
    from public.gallery_photos p join public.profiles u on u.id = p.contributor_id
    join public.gallery_vote_totals t on t.photo_id = p.id
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
revoke all on function public.gallery_feed(text, jsonb, integer) from public;
grant execute on function public.gallery_feed(text, jsonb, integer) to anon, authenticated, service_role;

-- An invoker function allows atomic, idempotent writes while enforcing RLS.
create function public.set_photo_vote(p_photo_id uuid, p_value smallint)
returns smallint language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and onboarding_completed_at is not null)
    then raise exception 'Finish signup before voting' using errcode = '42501'; end if;
  if p_value is not null and p_value not in (1, -1) then raise exception 'Invalid vote'; end if;
  -- Serialize this user's votes for this photo, including a concurrent removal.
  perform pg_advisory_xact_lock(hashtextextended(p_photo_id::text || auth.uid()::text, 0));
  if p_value is null then
    delete from public.photo_votes where photo_id = p_photo_id and voter_id = auth.uid();
  else
    insert into public.photo_votes(photo_id, voter_id, value) values (p_photo_id, auth.uid(), p_value)
    on conflict (photo_id, voter_id) do update set value = excluded.value;
  end if;
  return p_value;
end;
$$;
revoke all on function public.set_photo_vote(uuid, smallint) from public;
grant execute on function public.set_photo_vote(uuid, smallint) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
  ('gallery-staging', 'gallery-staging', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('generated-images', 'generated-images', false, 10485760, array['image/webp']),
  ('gallery-photos', 'gallery-photos', true, 10485760, array['image/webp']);
create policy "Read own saved generations" on storage.objects for select to authenticated using (
  bucket_id = 'generated-images' and (storage.foldername(name))[1] = (select auth.uid())::text
);
-- No client writes to buckets. Staging writes require a scoped signed ticket;
-- publication and generated assets are written only by verified server code.
commit;
