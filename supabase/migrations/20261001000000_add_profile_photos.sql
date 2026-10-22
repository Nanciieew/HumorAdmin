begin;

alter table public.profiles
  add column avatar_path text,
  add constraint profile_avatar_owner check (
    avatar_path is null or split_part(avatar_path, '/', 1) = id::text
  );

comment on column public.profiles.avatar_path is
  'Object path in the private profile-photos Storage bucket; never image bytes or base64 data.';

-- Only authenticated server actions using the service key access this bucket.
-- The application verifies user identity and derives each path from that ID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 2097152, array['image/webp']);

commit;
