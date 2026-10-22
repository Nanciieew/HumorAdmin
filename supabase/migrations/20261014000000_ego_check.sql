begin;
create table public.ego_friendships (
 id uuid primary key default gen_random_uuid(), requester uuid not null references public.profiles(id) on delete cascade,
 recipient uuid not null references public.profiles(id) on delete cascade, status text not null default 'pending' check(status in ('pending','accepted')),
 created_at timestamptz not null default now(), check(requester<>recipient)
);
create index ego_friend_requester on public.ego_friendships(requester,status);
create index ego_friend_recipient on public.ego_friendships(recipient,status);
create unique index ego_friend_pair on public.ego_friendships(least(requester,recipient),greatest(requester,recipient));
create table public.ego_challenges (
 id uuid primary key default gen_random_uuid(), creator uuid not null references public.profiles(id) on delete cascade,
 opponent uuid references public.profiles(id) on delete cascade, visibility text not null check(visibility in ('public','friends','private')),
 status text not null default 'invited' check(status in ('invited','preparing','voting','completed','declined','cancelled','expired')),
 created_at timestamptz not null default now(), invite_expires_at timestamptz not null default now()+interval '7 days',
 voting_ends_at timestamptz, completed_at timestamptz, winner uuid references public.profiles(id) on delete set null,
 creator_votes int not null default 0, opponent_votes int not null default 0, check(creator<>opponent)
);
create index ego_challenge_creator on public.ego_challenges(creator,created_at desc);
create index ego_challenge_opponent on public.ego_challenges(opponent,created_at desc);
create index ego_challenge_winner on public.ego_challenges(winner,completed_at);
create index ego_challenge_deadline on public.ego_challenges(status,voting_ends_at);
create table public.ego_entries (
 challenge_id uuid not null references public.ego_challenges(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade, roast text check(length(roast)<=240),
 storage_path text unique, receipt_hash text not null unique, approved_at timestamptz not null default now(), primary key(challenge_id,user_id)
);
create table public.ego_votes (
 challenge_id uuid not null references public.ego_challenges(id) on delete cascade,
 voter_id uuid not null references public.profiles(id) on delete cascade,
 target_id uuid not null references public.profiles(id) on delete cascade,
 primary key(challenge_id,voter_id)
);
create table public.ego_gallery_results (
 image_id uuid primary key references public.images(id) on delete cascade,
 challenge_id uuid not null references public.ego_challenges(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 battle_votes int not null, outcome text not null, roast text not null, unique(challenge_id,user_id)
);
create table public.ego_vote_months (
 photo_id uuid not null references public.images(id) on delete cascade, voter_id uuid not null references public.profiles(id) on delete cascade,
 month date not null, primary key(photo_id,voter_id,month)
);
create index ego_vote_month_period on public.ego_vote_months(month,photo_id);
create function public.ego_track_month() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.value=1 and (tg_op='INSERT' or old.value<>1) then
 insert into ego_vote_months values(new.photo_id,new.voter_id,date_trunc('month',now() at time zone 'America/New_York')::date) on conflict do nothing;
 end if; return new;
end $$;
create trigger ego_monthly_vote after insert or update on public.photo_votes for each row execute function public.ego_track_month();
create table public.ego_publication_locks(user_id uuid not null references profiles(id) on delete cascade,challenge_id uuid not null references ego_challenges(id) on delete cascade,token uuid not null,expires_at timestamptz not null,primary key(user_id,challenge_id));
create table public.ego_media_gc(path text primary key);
create table public.ego_configuration(id boolean primary key default true check(id), tracking_started_at timestamptz not null default now());
insert into public.ego_configuration default values;
create table public.ego_roast_sessions (
 user_id uuid not null references public.profiles(id) on delete cascade, session_id text not null, token uuid,
 lease_until timestamptz, next_at timestamptz, jokes jsonb not null default '[]', updated_at timestamptz not null default now(), primary key(user_id,session_id)
);
create table public.ego_roast_limits(user_id uuid primary key references public.profiles(id) on delete cascade, window_start timestamptz not null default now(), attempts int not null default 0);
-- Storage is service-only. The media proxy rechecks friendship and audience on every read.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('challenge-entries','challenge-entries',false,204800,array['image/webp']) on conflict(id) do nothing;
do $$ declare t text; begin
 foreach t in array array['ego_friendships','ego_challenges','ego_entries','ego_votes','ego_gallery_results','ego_vote_months','ego_configuration','ego_roast_sessions','ego_roast_limits','ego_media_gc','ego_publication_locks'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create function public.ego_friends(a uuid,b uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from ego_friendships where status='accepted' and ((requester=a and recipient=b) or (requester=b and recipient=a))) $$;
create function public.ego_can_view(c public.ego_challenges,u uuid) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(c.creator=u or c.opponent=u or (c.status in ('voting','completed') and (c.visibility='public' or (c.visibility='friends' and (ego_friends(u,c.creator) or ego_friends(u,c.opponent))))),false) $$;
create function public.ego_finalize() returns void language plpgsql security definer set search_path=public as $$
declare c ego_challenges; av int; bv int;
begin
 update ego_challenges set status='expired' where status in ('invited','preparing') and invite_expires_at<=now();
 for c in select * from ego_challenges where status='voting' and voting_ends_at<=now() order by id for update loop
 select count(*) filter(where target_id=c.creator),count(*) filter(where target_id=c.opponent) into av,bv from ego_votes where challenge_id=c.id;
 update ego_challenges set status='completed',completed_at=c.voting_ends_at,creator_votes=av,opponent_votes=bv,
 winner=case when av>bv then c.creator when bv>av then c.opponent else null end where id=c.id;
 end loop;
end $$;
-- All app mutations use this transaction boundary; clients never write these tables directly.
create function public.ego_action(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
#variable_conflict use_column
declare u uuid:=auth.uid(); c ego_challenges; f ego_friendships; battle_id uuid; target uuid; out jsonb; v text; av int; bv int;
begin
 if p_action not in ('arena','battle','rankings','gallery_metadata','media') and not exists(select 1 from profiles where profiles.id=u and onboarding_completed_at is not null) then raise exception 'Sign in and finish signup' using errcode='42501'; end if;
 perform ego_finalize();
 if p_action='search_people' then
 if length(trim(p_data->>'query'))<2 then return '[]'; end if;
 return coalesce((select jsonb_agg(row_to_json(x)) from (select id,concat_ws(' ',first_name,last_name) as name from profiles where onboarding_completed_at is not null and id<>u and concat_ws(' ',first_name,last_name) ilike '%'||left(p_data->>'query',80)||'%' order by first_name,id limit 20)x),'[]');
 elsif p_action='friends' then
 return coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'user_id',p.id,'name',concat_ws(' ',p.first_name,p.last_name),'status',f.status,'incoming',f.recipient=u)) from ego_friendships f join profiles p on p.id=case when f.requester=u then f.recipient else f.requester end where u in(f.requester,f.recipient)),'[]');
 elsif p_action='friend_request' then
 target:=(p_data->>'userId')::uuid;
 if target=u or not exists(select 1 from profiles where profiles.id=target and onboarding_completed_at is not null) then raise exception 'Invalid friend'; end if;
 if (select count(*) from ego_friendships where requester=u and created_at>now()-interval '1 day')>=30 then raise exception 'Friend request limit reached'; end if;
 insert into ego_friendships(requester,recipient) values(u,target) on conflict do nothing; return '{}';
 elsif p_action in ('friend_accept','friend_remove') then
 select * into f from ego_friendships where ego_friendships.id=(p_data->>'id')::uuid for update;
 if not found or u not in(f.requester,f.recipient) then raise exception 'Friend request unavailable'; end if;
 if p_action='friend_accept' then
 if f.recipient<>u then raise exception 'Only the recipient can accept'; end if;
 update ego_friendships set status='accepted' where ego_friendships.id=f.id;
 else delete from ego_friendships where ego_friendships.id=f.id; end if; return '{}';
 elsif p_action='create' then
 v:=p_data->>'visibility'; target:=nullif(p_data->>'opponent','')::uuid;
 if v not in ('public','friends','private') then raise exception 'Choose a visibility'; end if;
 if target is not null and not ego_friends(u,target) then raise exception 'Select an accepted friend'; end if;
 if (select count(*) from ego_challenges where creator=u and created_at>now()-interval '1 day')>=10 then raise exception 'Daily challenge limit reached'; end if;
 insert into ego_challenges(creator,opponent,visibility) values(u,target,v) returning ego_challenges.id into battle_id; return jsonb_build_object('id',battle_id);
 elsif p_action='arena' then
 return coalesce((select jsonb_agg(x.data order by x.created_at desc) from (select c.created_at,jsonb_build_object('id',c.id,'status',c.status,'visibility',c.visibility,'creator',concat_ws(' ',a.first_name,a.last_name),'opponent',concat_ws(' ',b.first_name,b.last_name),'endsAt',c.voting_ends_at,'creatorVotes',c.creator_votes,'opponentVotes',c.opponent_votes,'creatorId',c.creator,'opponentId',c.opponent,'entries',coalesce((select jsonb_agg(jsonb_build_object('userId',e.user_id,'publishedId',null,'roast',case when c.status in('cancelled','declined','expired') or c.completed_at<now()-interval '7 days' then null else e.roast end,'hasMedia',e.storage_path is not null and c.status not in('cancelled','declined','expired') and (c.completed_at is null or c.completed_at>=now()-interval '7 days'))) from ego_entries e where e.challenge_id=c.id),'[]')) data from ego_challenges c join profiles a on a.id=c.creator left join profiles b on b.id=c.opponent where case when p_data->>'scope'='mine' then u in(c.creator,c.opponent) else c.status in('voting','completed') and c.visibility='public' end order by c.created_at desc limit 60 offset least(greatest(coalesce((p_data->>'offset')::int,0),0),10000))x),'[]');
 elsif p_action='gallery_metadata' then
 return coalesce((select jsonb_agg(jsonb_build_object('image_id',g.image_id,'battle_votes',g.battle_votes,'outcome',g.outcome,'roast',g.roast)) from ego_gallery_results g join images i on i.id=g.image_id where i.published_at is not null and g.image_id in(select value::text::uuid from jsonb_array_elements_text(p_data->'ids'))),'[]');
 elsif p_action='rankings' then
 return jsonb_build_object('trackingStartedAt',(select tracking_started_at from ego_configuration),
 'weekly',coalesce((with eligible as(select c.*,least(c.creator,c.opponent) as pair_a,greatest(c.creator,c.opponent) as pair_b from ego_challenges c where c.status='completed' and c.visibility='public' and c.winner is not null and c.creator_votes+c.opponent_votes>=3 and c.completed_at>=date_trunc('week',now() at time zone 'America/New_York') at time zone 'America/New_York' and c.completed_at<(date_trunc('week',now() at time zone 'America/New_York')+interval '1 week') at time zone 'America/New_York'), dedup as(select distinct on(winner,pair_a,pair_b) * from eligible order by winner,pair_a,pair_b,completed_at,id), ranked as(select winner,count(*) wins,sum(case when winner=creator then creator_votes else opponent_votes end) votes from dedup group by winner) select jsonb_agg(row_to_json(x)) from(select p.id,concat_ws(' ',p.first_name,p.last_name) as name,r.wins,r.votes from ranked r join profiles p on p.id=r.winner order by r.wins desc,r.votes desc,p.id limit 50)x),'[]'),
 'monthly',coalesce((select jsonb_agg(row_to_json(x)) from(select i.id,i.title,i.public_storage_path,concat_ws(' ',p.first_name,p.last_name) as name,count(*) as votes,t.upvotes as lifetime_votes from ego_vote_months m join photo_votes pv on pv.photo_id=m.photo_id and pv.voter_id=m.voter_id and pv.value=1 join images i on i.id=m.photo_id and i.published_at is not null join profiles p on p.id=i.contributor_id join gallery_vote_totals t on t.photo_id=i.id where m.month=date_trunc('month',now() at time zone 'America/New_York')::date group by i.id,p.first_name,p.last_name,t.upvotes order by count(*) desc,t.upvotes desc,i.published_at desc,i.id limit 50)x),'[]'));
 elsif p_action='summary' then
 return jsonb_build_object('wins',(select count(*) from (select distinct date_trunc('week',completed_at at time zone 'America/New_York'),least(creator,opponent),greatest(creator,opponent) from ego_challenges where winner=u and status='completed' and visibility='public' and creator_votes+opponent_votes>=3)qualifying),'active',(select count(*) from ego_challenges where u in(creator,opponent) and status in('preparing','voting')),'invitations',(select count(*) from ego_challenges where opponent=u and status='invited'));
 end if;
 battle_id:=(p_data->>'id')::uuid;
 select * into c from ego_challenges where ego_challenges.id=battle_id for update;
 if not found then raise exception 'Challenge unavailable' using errcode='42501'; end if;
 if p_action='accept' then
 if u=c.creator or c.status<>'invited' or c.invite_expires_at<=clock_timestamp() or (c.opponent is not null and c.opponent<>u) then raise exception 'Invitation unavailable'; end if;
 update ego_challenges set opponent=u,status='preparing' where ego_challenges.id=battle_id; return '{}';
 elsif p_action='battle' then
 -- An unclaimed invitation discloses only creator and audience to signed-in recipients.
 if not ego_can_view(c,u) and not(c.status='invited' and c.opponent is null and u is not null) then raise exception 'Challenge unavailable' using errcode='42501'; end if;
 select jsonb_build_object('id',c.id,'creatorId',c.creator,'opponentId',c.opponent,'creator',concat_ws(' ',a.first_name,a.last_name),'opponent',concat_ws(' ',b.first_name,b.last_name),'status',c.status,'visibility',c.visibility,'endsAt',c.voting_ends_at,'expiresAt',c.invite_expires_at,'winner',c.winner,'creatorVotes',case when c.status='voting' then(select count(*) from ego_votes where challenge_id=battle_id and target_id=c.creator) else c.creator_votes end,'opponentVotes',case when c.status='voting' then(select count(*) from ego_votes where challenge_id=battle_id and target_id=c.opponent) else c.opponent_votes end,'myVote',(select target_id from ego_votes where challenge_id=battle_id and voter_id=u),'entries',coalesce((select jsonb_agg(jsonb_build_object('userId',e.user_id,'roast',case when c.status in('cancelled','expired','declined') or c.completed_at<now()-interval '7 days' then null else e.roast end,'hasMedia',e.storage_path is not null and c.status not in('cancelled','expired','declined') and (c.completed_at is null or c.completed_at>=now()-interval '7 days'),'publishedId',(select image_id from ego_gallery_results g where g.challenge_id=battle_id and g.user_id=e.user_id))) from ego_entries e where e.challenge_id=battle_id and (c.status in('voting','completed') or u in(c.creator,c.opponent))),'[]')) into out from profiles a left join profiles b on b.id=c.opponent where a.id=c.creator;
 return out;
 elsif p_action='vote' then
 if c.status<>'voting' or c.voting_ends_at<=clock_timestamp() or c.visibility='private' or not ego_can_view(c,u) or u in(c.creator,c.opponent) then raise exception 'Voting unavailable'; end if;
 target:=nullif(p_data->>'target','')::uuid;
 if target is null then delete from ego_votes where challenge_id=battle_id and voter_id=u;
 else if target not in(c.creator,c.opponent) then raise exception 'Invalid vote'; end if;
 insert into ego_votes values(battle_id,u,target) on conflict(challenge_id,voter_id) do update set target_id=excluded.target_id; end if; return '{}';
 elsif p_action in('cancel','decline') then
 if (u<>c.creator and u is distinct from c.opponent) or (p_action='decline' and (c.opponent<>u or c.status<>'invited')) then raise exception 'Action unavailable'; end if;
 update ego_challenges set status=case when p_action='decline' then 'declined' else 'cancelled' end,winner=null,completed_at=coalesce(completed_at,now()) where ego_challenges.id=battle_id; return '{}';
 elsif p_action='entry' then
 if (u<>c.creator and u is distinct from c.opponent) or c.invite_expires_at<=clock_timestamp() or not(c.status='preparing' or (c.status='invited' and u=c.creator)) or length(p_data->>'roast') not between 1 and 240 or p_data->>'path'<>u::text||'/'||battle_id::text||'.webp' then raise exception 'Entry unavailable'; end if;
 insert into ego_entries values(battle_id,u,p_data->>'roast',p_data->>'path',p_data->>'receipt',now()) on conflict(challenge_id,user_id) do nothing;
 if (select count(*) from ego_entries where challenge_id=battle_id)=2 then
 update ego_challenges set status=case when visibility='private' then 'completed' else 'voting' end,voting_ends_at=case when visibility<>'private' then now()+interval '48 hours' end,completed_at=case when visibility='private' then now() end where ego_challenges.id=battle_id;
 end if; return '{}';
 elsif p_action='media' then
 if not ego_can_view(c,u) or c.status not in('invited','preparing','voting','completed') or c.completed_at<now()-interval '7 days' then raise exception 'Media unavailable' using errcode='42501'; end if;
 return (select jsonb_build_object('path',storage_path) from ego_entries where challenge_id=battle_id and user_id=(p_data->>'userId')::uuid);
 elsif p_action='publish_info' then
 if c.status<>'completed' or (u<>c.creator and u is distinct from c.opponent) then raise exception 'Result unavailable'; end if;
 return (select jsonb_build_object('path',storage_path,'roast',roast,'votes',case when u=c.creator then c.creator_votes else c.opponent_votes end,'outcome',case when c.visibility='private' then 'Private exchange' when c.winner is null then 'Draw' when c.winner=u then 'Got cooked harder' else 'Survived this round' end,'imageId',(select image_id from ego_gallery_results where challenge_id=battle_id and user_id=u)) from ego_entries where challenge_id=battle_id and user_id=u);
 elsif p_action='publish' then
 if c.status<>'completed' or (u<>c.creator and u is distinct from c.opponent) then raise exception 'Result unavailable'; end if;
 select image_id into target from ego_gallery_results where challenge_id=battle_id and user_id=u; if found then return jsonb_build_object('imageId',target); end if;
 select jsonb_build_object('roast',roast,'path',storage_path) into out from ego_entries where challenge_id=battle_id and user_id=u;
 if out->>'path' is null then raise exception 'Snapshot has expired'; end if;
 target:=gen_random_uuid();
 insert into images(id,contributor_id,source,public_storage_path,title,description,published_at) values(target,u,'upload',u::text||'/challenge-'||battle_id::text||'.webp','Ego checked.',out->>'roast',now());
 insert into ego_gallery_results values(target,battle_id,u,case when u=c.creator then c.creator_votes else c.opponent_votes end,case when c.visibility='private' then 'Private exchange' when c.winner is null then 'Draw' when c.winner=u then 'Got cooked harder' else 'Survived this round' end,out->>'roast');
 return jsonb_build_object('imageId',target);
 elsif p_action='unpublish' then
 if (u<>c.creator and u is distinct from c.opponent) then raise exception 'Result unavailable'; end if;
 delete from images where images.id in(select image_id from ego_gallery_results where challenge_id=battle_id and user_id=u);
 return jsonb_build_object('path',u::text||'/challenge-'||battle_id::text||'.webp');
 end if;
 raise exception 'Unknown action';
end $$;
-- Entry and publication commands must only be called by the server after receipt/media validation.
-- Separate service RPC accepts an explicit owner; all other actions bind auth.uid().
create function public.ego_server_action(p_user uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if p_action not in('entry','publish','unpublish','publish_info','media') then raise exception 'Invalid server action'; end if;
 perform set_config('request.jwt.claim.sub',p_user::text,true);
 return ego_action(p_action,p_data);
end $$;
-- Public wrapper forbids the receipt-validated write operations even when called directly via PostgREST.
alter function public.ego_action(text,jsonb) rename to ego_internal;
create function public.ego_action(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>8192 then raise exception 'Invalid request'; end if;
 if p_action in('entry','publish','unpublish','publish_info','media') then raise exception 'Use the upload endpoint' using errcode='42501'; end if;
 return ego_internal(p_action,p_data);
end $$;
create or replace function public.ego_server_action(p_user uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if p_action not in('entry','publish','unpublish','publish_info','media') then raise exception 'Invalid server action'; end if;
 perform set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true);
 return ego_internal(p_action,p_data);
end $$;
create function public.ego_maintenance() returns jsonb language plpgsql security definer set search_path=public as $$
declare paths jsonb;
begin
 perform ego_finalize();
 insert into ego_media_gc select e.storage_path from ego_entries e join ego_challenges c on c.id=e.challenge_id where e.storage_path is not null and (c.status in('cancelled','declined','expired') or c.completed_at<now()-interval '7 days') on conflict do nothing;
 select coalesce(jsonb_agg(path),'[]') into paths from ego_media_gc;
 update ego_entries e set storage_path=null,roast=null from ego_challenges c where c.id=e.challenge_id and (c.status in('cancelled','declined','expired') or c.completed_at<now()-interval '7 days');
 delete from ego_roast_sessions where updated_at<now()-interval '15 minutes';
 delete from ego_roast_limits where window_start<now()-interval '1 day';
 return paths;
end $$;
-- Persist leases and limits across Vercel instances. Global advisory lock makes acquisition atomic.
create function public.ego_roast_lock(p_user uuid,p_session text,p_token uuid,p_mode text,p_roast text default null) returns jsonb language plpgsql security definer set search_path=public as $$
#variable_conflict use_column
declare s ego_roast_sessions; n int;
begin
 perform pg_advisory_xact_lock(843271);
 if p_mode='reset' then update ego_roast_sessions set token=null,jokes='[]',updated_at=now() where user_id=p_user and session_id=p_session; return '{}'; end if;
 if p_mode='acquire' then
 delete from ego_roast_sessions where updated_at<now()-interval '15 minutes';
 if (select count(*) from ego_roast_sessions where lease_until>now())>=4 or ((select count(*) from ego_roast_sessions)>=500 and not exists(select 1 from ego_roast_sessions where user_id=p_user and session_id=p_session)) then return null; end if;
 insert into ego_roast_limits(user_id) values(p_user) on conflict do nothing;
 update ego_roast_limits set attempts=case when window_start<now()-interval '1 minute' then 1 else attempts+1 end,window_start=case when window_start<now()-interval '1 minute' then now() else window_start end where user_id=p_user returning attempts into n;
 if n>10 then return null; end if;
 insert into ego_roast_sessions(user_id,session_id) values(p_user,p_session) on conflict do nothing;
 select * into s from ego_roast_sessions where user_id=p_user and session_id=p_session for update;
 if s.lease_until>now() or s.next_at>now() then return null; end if;
 update ego_roast_sessions set token=p_token,lease_until=now()+interval '20 seconds',next_at=now()+interval '8 seconds',updated_at=now() where user_id=p_user and session_id=p_session;
 return jsonb_build_object('jokes',s.jokes);
 elsif p_mode='finish' then
 update ego_roast_sessions set lease_until=null,jokes=case when p_roast is null then jokes else (select coalesce(jsonb_agg(value),'[]') from (select value from jsonb_array_elements(jokes||jsonb_build_array(p_roast)) with ordinality a(value,n) order by n desc limit 8)x) end,updated_at=now() where user_id=p_user and session_id=p_session and token=p_token and lease_until>now();
 return jsonb_build_object('current',found);
 end if; raise exception 'Invalid lease mode';
end $$;
create function public.ego_publication_lease(p_user uuid,p_challenge uuid,p_token uuid,p_release boolean default false) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from ego_challenges where id=p_challenge and p_user in(creator,opponent)) then return false; end if;
 if p_release then delete from ego_publication_locks where user_id=p_user and challenge_id=p_challenge and token=p_token;return true;end if;
 insert into ego_publication_locks values(p_user,p_challenge,p_token,now()+interval '30 seconds') on conflict(user_id,challenge_id) do update set token=excluded.token,expires_at=excluded.expires_at where ego_publication_locks.expires_at<now();
 return found;
end $$;
revoke all on function public.ego_publication_lease(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.ego_publication_lease(uuid,uuid,uuid,boolean) to service_role;
-- No helper receives default PUBLIC execute rights.
revoke all on function public.ego_internal(text,jsonb),public.ego_friends(uuid,uuid),public.ego_can_view(public.ego_challenges,uuid),public.ego_finalize(),public.ego_server_action(uuid,text,jsonb),public.ego_maintenance(),public.ego_roast_lock(uuid,text,uuid,text,text),public.ego_track_month() from public,anon,authenticated;
revoke all on function public.ego_action(text,jsonb) from public;
grant execute on function public.ego_action(text,jsonb) to anon,authenticated,service_role;
grant execute on function public.ego_server_action(uuid,text,jsonb),public.ego_maintenance(),public.ego_roast_lock(uuid,text,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
