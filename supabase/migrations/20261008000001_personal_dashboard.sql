-- Aggregate only the selected contributor; never expose raw sale records to browsers.
create function public.personal_dashboard_summary(p_contributor_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'published_count', (select count(*)::text from public.images i
      where i.contributor_id = p_contributor_id and i.published_at is not null and i.published_at <= now()),
    'upvotes', (select coalesce(sum(t.upvotes),0)::text from public.images i
      left join public.gallery_vote_totals t on t.photo_id = i.id
      where i.contributor_id = p_contributor_id and i.published_at is not null and i.published_at <= now()),
    'revenue_cents', (select coalesce(sum(s.amount_cents-s.refunded_cents),0)::text
      from public.image_sales s where s.seller_id = p_contributor_id and s.sold_at <= now() and s.recorded_at <= now())
  );
$$;
revoke all on function public.personal_dashboard_summary(uuid) from public, anon, authenticated;
grant execute on function public.personal_dashboard_summary(uuid) to service_role;
