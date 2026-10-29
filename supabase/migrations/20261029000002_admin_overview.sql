begin;

-- One database snapshot; signup totals include accounts awaiting a profile.
create or replace function public.admin_overview(p_as_of timestamptz default now())
returns jsonb language sql stable security definer set search_path = '' as $$
  with period as (
    select date_trunc('month', p_as_of at time zone 'America/New_York') as local_start
  ), bounds as (
    select local_start at time zone 'America/New_York' as starts_at,
      (local_start + interval '1 month') at time zone 'America/New_York' as ends_at
    from period
  ), users as (
    select count(*)::text as total_users,
      count(*) filter(where u.created_at >= b.starts_at and u.created_at < b.ends_at and u.created_at <= p_as_of)::text as new_users_this_month
    from auth.users u cross join bounds b
  ), media as (
    select count(*) filter(where source = 'generated')::text as total_memes,
      count(*) filter(where source = 'upload' and published_at is not null)::text as total_egos
    from public.images
  )
  select jsonb_build_object(
    'total_users', u.total_users, 'new_users_this_month', u.new_users_this_month,
    'total_memes', m.total_memes, 'total_egos', m.total_egos,
    'month_start', b.starts_at, 'month_end', b.ends_at, 'updated_at', p_as_of
  ) from users u cross join media m cross join bounds b;
$$;

revoke all on function public.admin_overview(timestamptz) from public,anon,authenticated;
grant execute on function public.admin_overview(timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
