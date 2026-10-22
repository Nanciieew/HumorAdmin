-- Apply ONLY after deploying and verifying the app that queries images directly.
begin;
set local lock_timeout = '10s';
drop view if exists public.my_works restrict;
notify pgrst, 'reload schema';
commit;
