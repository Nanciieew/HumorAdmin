begin;

alter table public.profiles
  add column first_name text,
  add column last_name text;

commit;
