begin;

alter table public.profiles add column is_superadmin boolean not null default false;
-- Profile writes remain server-only. In particular, an account cannot promote itself.
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert(is_superadmin), update(is_superadmin) on public.profiles from anon, authenticated;

create function public.admin_users_page(p_search text default '', p_offset integer default 0,
  p_limit integer default 25, p_completed boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  with matches as (
    select u.id, u.email, u.created_at as account_created_at,
      p.created_at as profile_created_at, p.first_name, p.last_name,
      p.state_code, p.onboarding_completed_at, coalesce(p.is_superadmin, false) as is_superadmin
    from auth.users u left join public.profiles p on p.id = u.id
    where (not coalesce(p_completed, false) or p.onboarding_completed_at is not null)
      and (coalesce(p_search, '') = '' or position(lower(left(p_search, 200)) in
        lower(concat_ws(' ', u.id::text, u.email, p.first_name, p.last_name))) > 0)
  ), page as (
    select * from matches order by account_created_at desc, id desc
    limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))
  ) select jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(page)
    order by account_created_at desc, id desc) from page), '[]'::jsonb),
    'total', (select count(*)::text from matches));
$$;

create function public.admin_media_page(p_search text default '', p_owner uuid default null,
  p_source text default null, p_status text default null, p_offset integer default 0, p_limit integer default 25)
returns jsonb language sql stable security definer set search_path = '' as $$
  with matches as (
    select i.id, i.contributor_id, i.source, i.title, i.description, i.created_at, i.published_at,
      concat_ws(' ', p.first_name, p.last_name) as owner_name
    from public.images i join public.profiles p on p.id = i.contributor_id
    where (p_owner is null or i.contributor_id = p_owner)
      and (p_source is null or i.source = p_source)
      and (p_status is null or (p_status = 'published' and i.published_at is not null)
        or (p_status = 'private' and i.published_at is null))
      and (coalesce(p_search, '') = '' or position(lower(left(p_search, 200)) in
        lower(concat_ws(' ', i.id::text, i.title, i.description))) > 0)
  ), page as (
    select * from matches order by created_at desc, id desc
    limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))
  ) select jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(page) || jsonb_build_object(
    'upvotes', (select count(*)::text from public.photo_votes v where v.photo_id = page.id and v.value = 1),
    'downvotes', (select count(*)::text from public.photo_votes v where v.photo_id = page.id and v.value = -1))
    order by created_at desc, id desc) from page), '[]'::jsonb),
    'total', (select count(*)::text from matches));
$$;

create function public.admin_votes_page(p_kind text default 'gallery', p_target uuid default null,
  p_voter uuid default null, p_value smallint default null, p_offset integer default 0, p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_kind = 'gallery' then
    with matches as (
      select v.photo_id, v.voter_id, v.value, i.title,
        concat_ws(' ', p.first_name, p.last_name) as voter_name
      from public.photo_votes v join public.images i on i.id = v.photo_id
      left join public.profiles p on p.id = v.voter_id
      where (p_target is null or v.photo_id = p_target) and (p_voter is null or v.voter_id = p_voter)
        and (p_value is null or v.value = p_value)
    ), page as (
      select * from matches order by photo_id, voter_id
      limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))
    ) select jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(page) order by photo_id, voter_id)
      from page), '[]'::jsonb), 'total', (select count(*)::text from matches)) into result;
  elsif p_kind = 'battle' then
    with matches as (
      select v.challenge_id, v.voter_id, v.target_id,
        concat_ws(' ', p.first_name, p.last_name) as voter_name,
        concat_ws(' ', t.first_name, t.last_name) as target_name
      from public.ego_votes v left join public.profiles p on p.id = v.voter_id
      left join public.profiles t on t.id = v.target_id
      where (p_target is null or v.challenge_id = p_target) and (p_voter is null or v.voter_id = p_voter)
    ), page as (
      select * from matches order by challenge_id, voter_id
      limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))
    ) select jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(page) order by challenge_id, voter_id)
      from page), '[]'::jsonb), 'total', (select count(*)::text from matches)) into result;
  else raise exception 'Invalid vote kind'; end if;
  return result;
end;
$$;

revoke all on function public.admin_users_page(text,integer,integer,boolean),
  public.admin_media_page(text,uuid,text,text,integer,integer),
  public.admin_votes_page(text,uuid,uuid,smallint,integer,integer) from public, anon, authenticated;
grant execute on function public.admin_users_page(text,integer,integer,boolean),
  public.admin_media_page(text,uuid,text,text,integer,integer),
  public.admin_votes_page(text,uuid,uuid,smallint,integer,integer) to service_role;

commit;
