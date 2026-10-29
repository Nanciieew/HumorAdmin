begin;

alter table public.prompt_chains add column if not exists workflow_key text unique;

create table if not exists public.generation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  source text not null,
  external_request_id text,
  session_id text,
  factory_batch_id uuid references public.factory_batches(id) on delete set null,
  llm_model_id uuid references public.llm_models(id) on delete set null,
  prompt_chain_id uuid references public.prompt_chains(id) on delete set null,
  prompt_chain_step_id uuid references public.prompt_chain_steps(id) on delete set null,
  provider text,
  model text,
  attempt integer not null default 1 check(attempt > 0),
  status text not null default 'running' check(status in ('running','succeeded','failed','cancelled','historical')),
  request jsonb,
  prompt_snapshot jsonb,
  mix_snapshot jsonb,
  error jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists generation_requests_user_created on public.generation_requests(user_id,created_at desc);
create index if not exists generation_requests_factory on public.generation_requests(factory_batch_id);
create index if not exists generation_requests_status_created on public.generation_requests(status,created_at desc);
create index if not exists generation_requests_created on public.generation_requests(created_at desc,id);

-- Keep the old Factory FK for compatibility with the currently deployed admin.
-- request_id links every new call (including live roasts) to its full audit record.
alter table public.llm_responses
  add column if not exists request_id uuid unique references public.generation_requests(id) on delete set null,
  add column if not exists llm_model_id uuid references public.llm_models(id) on delete set null,
  add column if not exists prompt_chain_step_id uuid references public.prompt_chain_steps(id) on delete set null,
  add column if not exists status text,
  add column if not exists http_status integer,
  add column if not exists duration_ms integer,
  add column if not exists usage jsonb,
  add column if not exists error jsonb;

alter table public.generation_requests enable row level security;
revoke all on public.generation_requests from public,anon,authenticated;
grant select,insert,update,delete on public.generation_requests to service_role;

-- Preserve real legacy batches and responses without inventing missing prompts.
insert into public.generation_requests(id,user_id,source,factory_batch_id,status,request,created_at)
select id,user_id,'legacy_factory',id,'historical',
  jsonb_build_object('legacy_state',state,'variants',variants,'selected',selected,'raw_request_retained',false),created_at
from public.factory_batches b
where not exists(select 1 from public.generation_requests q where q.factory_batch_id=b.id)
on conflict(id) do nothing;
insert into public.generation_requests(id,source,factory_batch_id,provider,model,status,created_at,completed_at)
select id,'legacy_response',generation_request_id,provider,model,'historical',created_at,created_at
from public.llm_responses where request_id is null on conflict(id) do nothing;
update public.llm_responses set request_id=id,status='historical' where request_id is null;

create or replace function public.record_generation_start(p_entry jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_provider uuid; v_model uuid; v_chain uuid; v_step public.prompt_chain_steps;
  v_id uuid := (p_entry->>'id')::uuid;
begin
  insert into public.llm_providers(name,base_url)
  values(p_entry->>'provider',case p_entry->>'provider'
    when 'Google Gemini' then 'https://generativelanguage.googleapis.com/v1beta'
    when 'ByteDance Ark' then 'https://ark.cn-beijing.volces.com/api/v3' end)
  on conflict(name) do update set name=excluded.name returning id into v_provider;
  insert into public.llm_models(name,model_id,llm_provider_id)
  values(p_entry->>'model',p_entry->>'model',v_provider)
  on conflict(llm_provider_id,model_id) do update set model_id=excluded.model_id returning id into v_model;
  select id into strict v_chain from public.prompt_chains where workflow_key=p_entry->>'workflow';
  select * into strict v_step from public.prompt_chain_steps
    where prompt_chain_id=v_chain and position=coalesce((p_entry->>'step_position')::int,0);
  update public.prompt_chain_steps set llm_model_id=v_model where id=v_step.id;
  insert into public.generation_requests(
    id,user_id,source,external_request_id,session_id,factory_batch_id,llm_model_id,
    prompt_chain_id,prompt_chain_step_id,provider,model,attempt,request,prompt_snapshot,mix_snapshot
  ) values (
    v_id,(p_entry->>'user_id')::uuid,p_entry->>'source',p_entry->>'external_request_id',p_entry->>'session_id',
    (p_entry->>'factory_batch_id')::uuid,v_model,v_chain,v_step.id,p_entry->>'provider',p_entry->>'model',
    coalesce((p_entry->>'attempt')::int,1),p_entry->'request',
    jsonb_build_object('chain_id',v_chain,'step_id',v_step.id,'position',v_step.position,
      'name',v_step.name,'system_prompt',v_step.system_prompt,'user_prompt',v_step.user_prompt,'model_id',v_model),
    jsonb_build_object('selection','deployed_workflow','entry',
      (select to_jsonb(m) from public.prompt_chain_mix m where m.prompt_chain_id=v_chain))
  );
  return v_id;
end $$;

create or replace function public.record_generation_finish(p_id uuid,p_result jsonb)
returns void language plpgsql set search_path = '' as $$
declare v_request public.generation_requests;
begin
  select * into strict v_request from public.generation_requests where id=p_id for update;
  if v_request.status <> 'running' then return; end if;
  if p_result->>'status' not in ('succeeded','failed','cancelled') then raise exception 'Invalid generation status'; end if;
  insert into public.llm_responses(request_id,generation_request_id,llm_model_id,prompt_chain_step_id,
    provider,model,response,status,http_status,duration_ms,usage,error)
  values(p_id,v_request.factory_batch_id,v_request.llm_model_id,v_request.prompt_chain_step_id,
    v_request.provider,v_request.model,coalesce(p_result->'response','{}'::jsonb),p_result->>'status',
    (p_result->>'http_status')::int,(p_result->>'duration_ms')::int,
    coalesce(p_result#>'{response,usageMetadata}',p_result#>'{response,usage}'),p_result->'error');
  update public.generation_requests set status=p_result->>'status',error=p_result->'error',completed_at=now() where id=p_id;
end $$;

revoke all on function public.record_generation_start(jsonb) from public,anon,authenticated;
revoke all on function public.record_generation_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_generation_start(jsonb) to service_role;
grant execute on function public.record_generation_finish(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
