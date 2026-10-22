begin;

create or replace function public.create_profile_on_first_sign_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'given_name', '')
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'last_name', ''),
      nullif(new.raw_user_meta_data ->> 'family_name', '')
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

alter table public.profiles drop column display_name;

commit;
