import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://fixture.supabase.co';
process.env.SUPABASE_SECRET_KEY ??= 'fixture';
const { supabase } = await import('../lib/supabase.ts');
const server = await import('../lib/admin/resource-server.ts');
const { findAdminResource, adminResources } = await import('../lib/admin/resources.ts');
const route = await import('../app/api/admin/resources/[resource]/route.ts');
const itemRoute = await import('../app/api/admin/resources/[resource]/[id]/route.ts');
const id='10000000-0000-4000-8000-000000000001';
let flag=true, calls=[], result={data:[{id,term:'Wit',definition:'Definition'}],count:1,error:null};
globalThis.__adminAuthClient={auth:{getUser:async()=>({data:{user:{id,email_confirmed_at:'2026-01-01',identities:[{provider:'google'}]}}})},from(){return{select(){return{eq(){return{maybeSingle:async()=>({data:{is_superadmin:flag}})}}}}}}};
const savedFrom=supabase.from;
supabase.from=table=>{
  calls.push(['table',table]);
  const builder={then(resolve){return Promise.resolve(result).then(resolve);}};
  for(const name of ['select','eq','ilike','order','range','insert','update','delete','maybeSingle'])builder[name]=(...args)=>{calls.push([name,...args]);return builder;};
  return builder;
};
after(()=>{supabase.from=savedFrom;});
beforeEach(()=>{flag=true;calls=[];result={data:[{id,term:'Wit',definition:'Definition'}],count:1,error:null};});
const context=resource=>({params:Promise.resolve({resource,id})});
const request=(method='GET',body,origin='https://app.test')=>new Request('https://app.test/api/admin/resources/terms',{method,headers:{origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('all new resource operations enforce admin access before privileged data work',async()=>{
  flag=false;
  for(const resource of adminResources)for(const operation of [()=>server.listResource(resource.slug,new URLSearchParams()),()=>server.readResource(resource.slug,id),()=>server.writeResource(resource.slug,{}),()=>server.deleteResource(resource.slug,id,{confirmed:true})])await assert.rejects(operation(),error=>error.status===403);
  assert.equal(calls.length,0);
});
test('mutation routes reject foreign origin and read-only resources cannot be changed',async()=>{
  assert.equal((await route.POST(request('POST',{term:'Wit',definition:'D'},'https://evil.test'),context('terms'))).status,403);
  for(const resource of adminResources.filter(resource=>resource.mode==='read')){
    assert.equal((await route.POST(request('POST',{}),context(resource.slug))).status,405);
    assert.equal((await itemRoute.PATCH(request('PATCH',{}),context(resource.slug))).status,405);
    assert.equal((await itemRoute.DELETE(request('DELETE',{confirmed:true}),context(resource.slug))).status,405);
  }
  assert.equal((await route.POST(request('POST',{weight:1,enabled:true}),context('prompt-chain-mix'))).status,405);
  assert.equal(calls.length,0);
});
test('resource allowlist and field validation reject arbitrary tables, protected fields and malformed values',async()=>{
  await assert.rejects(server.listResource('profiles',new URLSearchParams()),error=>error.status===404);
  for(const body of [{term:'',definition:'D'},{term:'Wit'},{term:'Wit',definition:'D',is_superadmin:true},{id,term:'Wit',definition:'D'}])assert.throws(()=>server.resourceValues(findAdminResource('terms'),body,true));
  for(const weight of [-1,Infinity,'5',null])assert.throws(()=>server.resourceValues(findAdminResource('prompt-chain-mix'),{weight},false));
  assert.throws(()=>server.resourceValues(findAdminResource('llm-models'),{llm_provider_id:'bad'},false));
  assert.throws(()=>server.resourceValues(findAdminResource('llm-providers'),{base_url:'https://secret@example.com'},false));
  assert.throws(()=>server.resourceValues(findAdminResource('allowed-signup-domains'),{domain:'@example.com'},true));
  assert.deepEqual(server.resourceValues(findAdminResource('whitelisted-emails'),{email:' ADMIN@Columbia.EDU '},true),{email:'admin@columbia.edu'});
  assert.equal(calls.length,0);
});
test('list pagination, filters and literal search are bounded and ordered',async()=>{
  const page=await server.listResource('terms',new URLSearchParams('search=%_&page=2&limit=10'));
  assert.equal(page.total,'1');assert.deepEqual(calls.find(call=>call[0]==='range'),['range',10,19]);
  assert.deepEqual(calls.find(call=>call[0]==='ilike'),['ilike','term','%\\%\\_%']);
  calls=[];await assert.rejects(server.listResource('prompt-chain-steps',new URLSearchParams('prompt_chain_id=bad')),error=>error.status===400);
  await assert.rejects(server.listResource('terms',new URLSearchParams('limit=101')),error=>error.status===400);
});
test('CRUD returns rows and conflict errors without leaking database details',async()=>{
  result.data={id,term:'Wit',definition:'Definition'};
  assert.equal((await route.POST(request('POST',{term:'Wit',definition:'Definition'}),context('terms'))).status,201);
  assert.equal((await itemRoute.GET(request(),context('terms'))).status,200);
  assert.equal((await itemRoute.PATCH(request('PATCH',{definition:'Updated'}),context('terms'))).status,200);
  assert.equal((await itemRoute.DELETE(request('DELETE',{}),context('terms'))).status,400);
  result.error={code:'23503',message:'private database details'};
  const conflict=await itemRoute.DELETE(request('DELETE',{confirmed:true}),context('terms'));
  assert.equal(conflict.status,409);assert.ok(!(await conflict.text()).includes('private database'));
  result.error=null;assert.equal((await itemRoute.DELETE(request('DELETE',{confirmed:true}),context('terms'))).status,200);
  result.data=null;assert.equal((await itemRoute.PATCH(request('PATCH',{term:'Missing'}),context('terms'))).status,404);
});

test('generation screens read all AI calls and filter responses using the canonical request ID',async()=>{
 await server.listResource('generation-requests',new URLSearchParams());
 assert.deepEqual(calls.find(call=>call[0]==='table'),['table','generation_requests']);
 assert.ok(calls.find(call=>call[0]==='select')[1].includes('prompt_snapshot'));
 calls=[];
 await server.listResource('llm-responses',new URLSearchParams({request_id:id}));
 assert.deepEqual(calls.find(call=>call[0]==='eq'),['eq','request_id',id]);
 assert.ok(calls.find(call=>call[0]==='select')[1].includes('duration_ms'));
});
