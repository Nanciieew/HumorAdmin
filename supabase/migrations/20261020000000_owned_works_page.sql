begin;

create index if not exists images_owner_display_order
  on public.images(contributor_id, (coalesce(published_at, created_at)) desc, id desc);

-- Server-only: the caller supplies the authenticated owner. Never grant to clients.
create or replace function public.owned_works_page(
  p_contributor_id uuid, p_sort text default 'top', p_cursor jsonb default null, p_limit integer default 30
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 60));
  v_result jsonb;
begin
  if p_contributor_id is null or p_sort is null or p_sort not in ('top', 'newest') then
    raise exception 'Invalid works request';
  end if;
  if p_cursor is not null and (
    p_cursor->>'sort' is distinct from p_sort or
    not (p_cursor ?& array['id', 'time', 'upvotes']) or
    p_cursor->>'id' is null or p_cursor->>'time' is null or
    coalesce(p_cursor->>'upvotes', '') !~ '^[0-9]{1,40}$'
  ) then raise exception 'Invalid works cursor'; end if;

  with ranked as (
    select i.id, i.source, i.created_at, i.published_at, i.title, i.description,
      i.private_storage_path, i.public_storage_path,
      coalesce(i.published_at, i.created_at) as time,
      coalesce(v.upvotes, 0) as upvotes, coalesce(v.downvotes, 0) as downvotes,
      case when p_sort = 'top' then coalesce(v.upvotes, 0) else 0 end as score
    from public.images i left join public.gallery_vote_totals v on v.photo_id = i.id
    where i.contributor_id = p_contributor_id
  ), batch as (
    select * from ranked where p_cursor is null or
      (score::numeric, time, id) < (
        case when p_sort = 'top' then (p_cursor->>'upvotes')::numeric else 0 end,
        (p_cursor->>'time')::timestamptz, (p_cursor->>'id')::uuid
      )
    order by score desc, time desc, id desc limit v_limit + 1
  ), page as (
    select * from batch order by score desc, time desc, id desc limit v_limit
  ) select jsonb_build_object(
    'items', coalesce((select jsonb_agg(
      (to_jsonb(page) - 'score' - 'time') || jsonb_build_object('upvotes', upvotes::text, 'downvotes', downvotes::text)
      order by score desc, time desc, id desc
    ) from page), '[]'::jsonb),
    'received', (select jsonb_build_object(
      'upvotes', coalesce(sum(upvotes), 0)::text, 'downvotes', coalesce(sum(downvotes), 0)::text
    ) from ranked),
    'next_cursor', case when (select count(*) from batch) > v_limit then (
      select jsonb_build_object('sort', p_sort, 'id', id, 'time', time, 'upvotes', upvotes::text)
      from page order by score, time, id limit 1
    ) else null end
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.owned_works_page(uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.owned_works_page(uuid, text, jsonb, integer) to service_role;
notify pgrst, 'reload schema';
commit;
