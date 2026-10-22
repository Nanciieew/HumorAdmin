begin;
alter table public.profiles
  add column if not exists state_code text,
  add column if not exists onboarding_completed_at timestamptz;
alter table public.profiles add constraint profiles_state_code_check check (
  state_code is null or state_code in (
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
    'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
  )
);
alter table public.profiles add constraint profiles_onboarding_complete_check check (
  onboarding_completed_at is null or (
    nullif(btrim(first_name), '') is not null and
    nullif(btrim(last_name), '') is not null and state_code is not null
  )
);
commit;
