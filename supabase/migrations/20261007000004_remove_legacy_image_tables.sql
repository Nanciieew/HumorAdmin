begin;
set local lock_timeout = '10s';

-- Take a backup before applying. Lock both representations while verifying preservation.
lock table public.images, public.generated_images, public.gallery_photos,
  public.work_captions in access exclusive mode;

do $$
begin
  if exists (
    select 1 from public.generated_images g left join public.images i on i.id = g.id
    where i.id is null or i.source <> 'generated' or i.contributor_id <> g.contributor_id
      or i.private_storage_path is distinct from g.storage_path
      or i.created_at is distinct from g.created_at
  ) then
    raise exception 'Legacy generation data is missing or differs in images; refusing deletion';
  end if;
  if exists (
    select 1 from public.gallery_photos p left join public.images i on i.id = p.id
    where i.id is null or i.source <> p.source or i.contributor_id <> p.contributor_id
      or i.public_storage_path is distinct from p.storage_path
      or i.published_at is distinct from p.published_at
  ) then
    raise exception 'Legacy publication data is missing or differs in images; refusing deletion';
  end if;
  -- Current captions may intentionally differ after owner edits. Require their images/owners to exist.
  if exists (
    select 1 from public.work_captions c left join public.images i on i.id = c.work_id
    where i.id is null or i.contributor_id <> c.contributor_id
  ) then
    raise exception 'A legacy caption has no matching owned image; refusing deletion';
  end if;
end;
$$;

-- RESTRICT is intentional: unexpected remaining dependencies must abort the migration.
drop table public.gallery_photos, public.generated_images, public.work_captions;
notify pgrst, 'reload schema';
commit;
