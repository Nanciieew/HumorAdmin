begin;

-- OAuth creates an Auth identity, but signup creates the public profile.
drop trigger if exists profiles_on_signed_in_user_created on auth.users;
drop trigger if exists profiles_on_first_sign_in on auth.users;
drop function if exists public.create_profile_on_first_sign_in();

-- Completion inserts are handled by the verified server action. Keep existing
-- rows and allow the previous app release to operate during deployment.

commit;
