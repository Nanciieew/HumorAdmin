begin;
set local lock_timeout = '10s';
create index if not exists images_gallery_publication_order on public.images(published_at desc, id desc) where published_at is not null;

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
    not (p_cursor ?& array['id','published_at','score','as_of']) or
    p_cursor->>'id' is null or p_cursor->>'published_at' is null or p_cursor->>'score' is null or p_cursor->>'as_of' is null) then
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
      (score, published_at, id) < ((p_cursor->>'score')::bigint, (p_cursor->>'published_at')::timestamptz, (p_cursor->>'id')::uuid)
    order by score desc, published_at desc, id desc limit v_limit + 1
  ), page as (select * from batch order by score desc, published_at desc, id desc limit v_limit)
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg((to_jsonb(page) - 'score') || jsonb_build_object('published_at',
      to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
      order by score desc, published_at desc, id desc) from page), '[]'::jsonb),
    'next_cursor', case when (select count(*) from batch) > v_limit then (
      select jsonb_build_object('sort', p_sort, 'score', score, 'published_at', published_at, 'id', id, 'as_of', v_as_of)
      from page order by score, published_at, id limit 1
    ) else null end
  ) into v_result;
  return v_result;
end;
$$;

notify pgrst, 'reload schema';
commit;
