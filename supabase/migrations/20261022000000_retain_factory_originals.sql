-- Retain the original JPG/PNG alongside the rendered WebP in the existing
-- private bucket. Keep its current limits, access policies and allowed types.
update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime order by mime)
  from unnest(allowed_mime_types || array['image/jpeg', 'image/png']) as mime
)
where id = 'generated-images' and allowed_mime_types is not null;
