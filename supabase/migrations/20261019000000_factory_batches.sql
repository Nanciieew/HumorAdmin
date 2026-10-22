-- Private, short-lived factory previews. Only server routes access this table.
create table if not exists public.factory_batches (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'generating' check (state in ('generating','ready','publishing','published','discarded')),
  variants jsonb not null default '[]'::jsonb,
  selected integer check (selected between 0 and 4),
  lease_until timestamptz,
  cleaned_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists factory_batches_expiry on public.factory_batches (expires_at);
alter table public.factory_batches enable row level security;
revoke all on public.factory_batches from anon, authenticated;
grant all on public.factory_batches to service_role;
create unique index if not exists factory_one_generation_per_user
  on public.factory_batches(user_id) where state = 'generating';
