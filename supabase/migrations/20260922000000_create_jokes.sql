begin;

create table public.jokes (
  id uuid primary key default gen_random_uuid(),
  photo_url text not null check (photo_url ~ '^https?://[^[:space:]]+$'),
  funny_question text not null check (length(trim(funny_question)) > 0),
  funny_answer text not null check (length(trim(funny_answer)) > 0),
  created_at timestamptz not null default now()
);

alter table public.jokes enable row level security;

-- Visitors can read jokes. Writes remain restricted to database administrators.
revoke all on table public.jokes from anon, authenticated;
grant select on table public.jokes to anon, authenticated;

create policy "Anyone can read jokes"
  on public.jokes
  for select
  to anon, authenticated
  using (true);

commit;
