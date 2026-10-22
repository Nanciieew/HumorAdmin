begin;
set local lock_timeout = '10s';

-- The legacy joke table is unused by the current app. Back up its rows first.
-- No CASCADE: unexpected dependencies must abort rather than be deleted.
drop table if exists public.avatar;
notify pgrst, 'reload schema';
commit;
