begin;
set local lock_timeout = '10s';

alter table public.images
  add column price_cents bigint check (price_cents > 0 and price_cents <= 9007199254740991),
  add column publication_state_code text;
update public.images i set publication_state_code = p.state_code
from public.profiles p where p.id = i.contributor_id and i.published_at is not null;
alter table public.images add constraint images_publication_state_check check (
  (published_at is null and publication_state_code is null) or
  (published_at is not null and publication_state_code in (
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
    'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
  ) and publication_state_code is not null)
);
create index images_region_published on public.images(publication_state_code, published_at)
where published_at is not null;

create function public.capture_image_publication_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.published_at is not null and (tg_op = 'INSERT' or old.published_at is null) then
    select state_code into new.publication_state_code from public.profiles where id = new.contributor_id;
  elsif tg_op = 'UPDATE' and new.publication_state_code is distinct from old.publication_state_code then
    raise exception 'Publication state is historical and cannot be changed';
  end if;
  return new;
end;
$$;
revoke all on function public.capture_image_publication_state() from public, anon, authenticated;
create trigger capture_image_publication_state before insert or update on public.images
for each row execute function public.capture_image_publication_state();

create table public.image_sales (
  id uuid primary key default gen_random_uuid(),
  image_id uuid not null references public.images(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  seller_state_code text not null check (seller_state_code in (
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
    'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
  )),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 9007199254740991),
  refunded_cents bigint not null default 0 check (refunded_cents between 0 and amount_cents),
  sold_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  reference text not null unique check (reference = btrim(reference) and char_length(reference) between 1 and 200)
);
create index image_sales_date on public.image_sales(sold_at);
create index image_sales_seller_date on public.image_sales(seller_id, sold_at);
create index image_sales_region_date on public.image_sales(seller_state_code, sold_at);
create index image_sales_image on public.image_sales(image_id);
alter table public.image_sales enable row level security;
revoke all on public.image_sales from public, anon, authenticated, service_role;
grant select, insert on public.image_sales to service_role;
grant update(refunded_cents) on public.image_sales to service_role;

create function public.validate_image_sale()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_published timestamptz;
begin
  if tg_op = 'INSERT' then
    select contributor_id, published_at into new.seller_id, v_published
    from public.images where id = new.image_id for key share;
    if v_published is null then raise exception 'Only published images can be sold'; end if;
    if new.sold_at < v_published or new.sold_at > now() then
      raise exception 'Sale time must be after publication and cannot be in the future';
    end if;
    select state_code into new.seller_state_code from public.profiles
    where id = new.seller_id and onboarding_completed_at is not null for key share;
    if new.seller_state_code is null then raise exception 'Seller must have a completed profile'; end if;
  elsif row(new.id,new.image_id,new.seller_id,new.seller_state_code,new.amount_cents,new.sold_at,new.recorded_at,new.reference)
    is distinct from row(old.id,old.image_id,old.seller_id,old.seller_state_code,old.amount_cents,old.sold_at,old.recorded_at,old.reference) then
    raise exception 'Sale facts are immutable; only cumulative refunds may change';
  elsif new.refunded_cents < old.refunded_cents then
    raise exception 'Cumulative refunds cannot decrease';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_image_sale() from public, anon, authenticated;
create trigger validate_image_sale before insert or update on public.image_sales
for each row execute function public.validate_image_sale();

create function public.record_image_sale(p_image_id uuid, p_amount_cents bigint, p_reference text, p_sold_at timestamptz default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_sale public.image_sales; v_reference text := btrim(p_reference); v_id uuid;
begin
  if v_reference is null or char_length(v_reference) not between 1 and 200 then raise exception 'Provide a transaction reference of 1-200 characters'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_reference, 0));
  select * into v_sale from public.image_sales where reference = v_reference;
  if found then
    if v_sale.image_id is distinct from p_image_id or v_sale.amount_cents is distinct from p_amount_cents
      or (p_sold_at is not null and v_sale.sold_at is distinct from p_sold_at) then
      raise exception 'Transaction reference already exists with different sale details';
    end if;
    return v_sale.id;
  end if;
  insert into public.image_sales(image_id,amount_cents,reference,sold_at)
  values(p_image_id,p_amount_cents,v_reference,coalesce(p_sold_at,now())) returning id into v_id;
  return v_id;
end;
$$;
create function public.record_image_refund(p_sale_id uuid, p_refunded_cents bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.image_sales set refunded_cents = p_refunded_cents where id = p_sale_id;
  if not found then raise exception 'Sale not found'; end if;
end;
$$;
revoke all on function public.record_image_sale(uuid,bigint,text,timestamptz), public.record_image_refund(uuid,bigint) from public, anon, authenticated;
grant execute on function public.record_image_sale(uuid,bigint,text,timestamptz), public.record_image_refund(uuid,bigint) to service_role;

create function public.leaderboard_summary(p_period text default 'monthly', p_cursor jsonb default null, p_limit integer default 30)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_as_of timestamptz := coalesce((p_cursor->>'as_of')::timestamptz, now());
  v_start timestamptz;
  v_end timestamptz;
  v_after bigint := coalesce((p_cursor->>'rank')::bigint, 0);
  v_limit integer := greatest(1,least(coalesce(p_limit,30),60));
  v_result jsonb;
begin
  if p_period is null or p_period not in ('monthly','all_time') then raise exception 'Invalid leaderboard period'; end if;
  if p_cursor is not null and (p_cursor->>'period' is distinct from p_period
    or not (p_cursor ?& array['period','as_of','rank']) or p_cursor->>'rank' is null
    or p_cursor->>'as_of' is null or v_after < 0 or v_as_of > now()) then raise exception 'Invalid leaderboard cursor'; end if;
  v_start := date_trunc('month',v_as_of at time zone 'America/New_York') at time zone 'America/New_York';
  v_end := (date_trunc('month',v_as_of at time zone 'America/New_York') + interval '1 month') at time zone 'America/New_York';
  with published as (
    select i.*,coalesce(t.upvotes,0) as upvotes from public.images i
    left join public.gallery_vote_totals t on t.photo_id = i.id
    where i.published_at is not null and i.published_at <= v_as_of
  ), scoped_images as (
    select * from published where p_period = 'all_time' or (published_at >= v_start and published_at < v_end)
  ), sales as (
    select * from public.image_sales where sold_at <= v_as_of and recorded_at <= v_as_of
  ), scoped_sales as (
    select * from sales where p_period = 'all_time' or (sold_at >= v_start and sold_at < v_end)
  ), creator_images as (
    select contributor_id,count(*) as avatars_made,sum(upvotes) as total_votes,max(created_at) as latest_creation
    from scoped_images group by contributor_id
  ), creator_sales as (
    select seller_id,sum(amount_cents-refunded_cents) as revenue_cents from scoped_sales group by seller_id
  ), ranked as (
    select row_number() over (order by coalesce(s.revenue_cents,0) desc,i.latest_creation desc nulls last,p.id) as rank,
      p.id as contributor_id,concat_ws(' ',p.first_name,p.last_name) as name,p.avatar_path,
      coalesce(i.avatars_made,0) as avatars_made,coalesce(i.total_votes,0) as total_votes,
      coalesce(s.revenue_cents,0)::text as revenue_cents
    from public.profiles p left join creator_images i on i.contributor_id=p.id
    left join creator_sales s on s.seller_id=p.id
    where p.onboarding_completed_at is not null and (i.contributor_id is not null or s.seller_id is not null)
  ), batch as (
    select * from ranked where rank>v_after order by rank limit v_limit+1
  ), page as (select * from batch order by rank limit v_limit),
  monthly_avatars as (
    select i.id,i.contributor_id,concat_ws(' ',p.first_name,p.last_name) as name,p.avatar_path,
      coalesce(nullif(i.title,''),'Untitled avatar') as title,i.public_storage_path,i.upvotes,
      row_number() over (order by i.upvotes desc,i.created_at desc,i.id desc) as rank
    from published i join public.profiles p on p.id=i.contributor_id
    where i.published_at>=v_start and i.published_at<v_end and p.onboarding_completed_at is not null
    order by i.upvotes desc,i.created_at desc,i.id desc limit 3
  ), region_images as (
    select publication_state_code as state_code,count(*) as avatars_contributed
    from published where published_at>=v_start and published_at<v_end group by publication_state_code
  ), region_sales as (
    select seller_state_code as state_code,sum(amount_cents-refunded_cents) as revenue_cents
    from sales where sold_at>=v_start and sold_at<v_end group by seller_state_code
  ), regions as (
    select coalesce(i.state_code,s.state_code) as state_code,coalesce(i.avatars_contributed,0) as avatars_contributed,
      coalesce(s.revenue_cents,0)::text as revenue_cents,
      row_number() over (order by coalesce(s.revenue_cents,0) desc,coalesce(i.state_code,s.state_code)) as rank
    from region_images i full join region_sales s on s.state_code=i.state_code
    order by coalesce(s.revenue_cents,0) desc,coalesce(i.state_code,s.state_code) limit 3
  ) select jsonb_build_object(
    'period',p_period,'as_of',v_as_of,'month_start',v_start,'month_end',v_end,
    'individuals',coalesce((select jsonb_agg(page order by rank) from page),'[]'::jsonb),
    'podium',coalesce((select jsonb_agg(r order by rank) from (select * from ranked order by rank limit 3) r),'[]'::jsonb),
    'monthly_top_avatars',coalesce((select jsonb_agg(a order by a.rank) from monthly_avatars a),'[]'::jsonb),
    'monthly_top_regions',coalesce((select jsonb_agg(r order by r.rank) from regions r),'[]'::jsonb),
    'monthly_rewards',jsonb_build_array(jsonb_build_object('rank',1,'credits',2000),jsonb_build_object('rank',2,'credits',1000),jsonb_build_object('rank',3,'credits',500)),
    'next_cursor',case when (select count(*) from batch)>v_limit then jsonb_build_object('period',p_period,'as_of',v_as_of,'rank',(select max(rank) from page)) else null end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.leaderboard_summary(text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.leaderboard_summary(text,jsonb,integer) to service_role;
notify pgrst, 'reload schema';
commit;
