begin;

-- Fail without changing anything if a profiles table already exists; inspect
-- its actual schema before adapting this migration in that case.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create function public.create_profile_on_first_sign_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_profile_on_first_sign_in()
  from public, anon, authenticated;

-- Some authentication flows record the first sign-in on user creation.
create trigger profiles_on_signed_in_user_created
  after insert on auth.users
  for each row
  when (new.last_sign_in_at is not null)
  execute function public.create_profile_on_first_sign_in();

-- Email registration and invitations can create a user before any sign-in.
-- Create the profile only when that user's first sign-in is recorded.
create trigger profiles_on_first_sign_in
  after update of last_sign_in_at on auth.users
  for each row
  when (old.last_sign_in_at is null and new.last_sign_in_at is not null)
  execute function public.create_profile_on_first_sign_in();

commit;
