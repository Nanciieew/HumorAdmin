import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import React from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000', pretendToBeVisual: true });
for (const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLSelectElement','MutationObserver','Node','Event','MouseEvent','getComputedStyle','FormData','File']) Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.self = dom.window;
globalThis.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
const { render, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react');
const { AdminConsole } = await import('../app/admin/console.tsx');
const originalFetch = globalThis.fetch;
const admin = { id: '10000000-0000-4000-8000-000000000001', email: 'admin@example.com' };
const media = { id: '20000000-0000-4000-8000-000000000001', contributor_id: admin.id, owner_name: 'Owner', source: 'generated', title: 'A meme', description: 'A caption', created_at: '2026-10-20T12:00:00Z', published_at: null, upvotes: '9', downvotes: '2' };
let refreshed = 0, pushed = [];
function mount(section='media',items=[media],total=String(items.length),params='') {
  return render(React.createElement(AppRouterContext.Provider,{value:{refresh(){refreshed++;},push(path){pushed.push(path);},replace(){},prefetch(){},back(){},forward(){}}},React.createElement(AdminConsole,{section,data:{items,total},params})));
}
afterEach(async()=>{await act(async()=>{});cleanup();globalThis.fetch=originalFetch;refreshed=0;pushed=[];});
test('users remain read-only, include pending accounts and page through records',()=>{
  const user={id:admin.id,email:admin.email,account_created_at:'2026-10-20T12:00:00Z',profile_created_at:null,first_name:null,last_name:null,state_code:null,onboarding_completed_at:null,is_superadmin:false};
  const ui=mount('users',[user],'30');
  assert.ok(ui.getByText('Awaiting profile'));assert.ok(ui.getByText('Onboarding pending'));
  assert.equal(ui.queryByRole('button',{name:'Delete'}),null);assert.equal(ui.queryByRole('button',{name:'Save captions'}),null);
  assert.equal(ui.getByRole('link',{name:'Next →'}).getAttribute('href'),'/admin/users?page=2');
});
test('media shows a single caption, larger protected preview, and a Factory edit link without record IDs',()=>{
  const ui=mount();assert.equal(ui.queryByText('Create media'),null);assert.equal(ui.getByRole('img').getAttribute('src'),`/api/admin/media/${media.id}/preview`);
  assert.ok(ui.getByText('↑ 9'));assert.ok(ui.getByText('↓ 2'));
  assert.ok(ui.getByText(media.description));assert.equal(ui.queryByText(media.title),null);
  assert.equal(ui.queryByRole('textbox',{name:/Description/}),null);
  assert.equal(ui.queryByText(media.id),null);assert.equal(ui.queryByText(media.contributor_id),null);
  assert.equal(ui.getByRole('img').getAttribute('width'),'300');
  assert.equal(ui.getByRole('link',{name:'Change caption'}).getAttribute('href'),`/disguise?media=${media.id}`);
});
test('deletion sends no request until confirmation, and cancel keeps the record',async()=>{
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({deleted:true});};
  const ui=mount();fireEvent.click(ui.getByRole('button',{name:'Delete'}));
  assert.ok(ui.getByRole('alertdialog'));assert.equal(calls.length,0);
  fireEvent.click(ui.getByRole('button',{name:'Cancel'}));assert.ok(!ui.queryByRole('alertdialog'));assert.equal(calls.length,0);
  fireEvent.click(ui.getByRole('button',{name:'Delete'}));fireEvent.click(ui.getByRole('button',{name:'Permanently delete'}));
  await waitFor(()=>assert.ok(!ui.queryByRole('alertdialog')));
  assert.equal(calls[0].options.method,'DELETE');assert.deepEqual(JSON.parse(calls[0].options.body),{confirmed:true});
});
test('sales conflicts keep the deletion dialog open and show the server error',async()=>{
  globalThis.fetch=async()=>Response.json({error:'Media with existing sales cannot be deleted.'},{status:409});
  const ui=mount();fireEvent.click(ui.getByRole('button',{name:'Delete'}));fireEvent.click(ui.getByRole('button',{name:'Permanently delete'}));
  await waitFor(()=>assert.ok(ui.getAllByText('Media with existing sales cannot be deleted.').length));
  assert.ok(ui.getByRole('alertdialog'));assert.equal(refreshed,0);
});
test('publishing uses its explicit action; expired sessions return to Google login',async()=>{
  let count=0;globalThis.fetch=async()=>{count++;return count===1?Response.json({id:media.id}):Response.json({error:'Sign in with Google to continue.'},{status:401});};
  const ui=mount();await act(async()=>{fireEvent.click(ui.getByRole('button',{name:'Publish'}));});assert.equal(refreshed,1);
  await waitFor(()=>assert.equal(ui.getByRole('button',{name:'Publish'}).disabled,false));
  await act(async()=>{fireEvent.click(ui.getByRole('button',{name:'Publish'}));});assert.equal(pushed[0],'/login?next=%2Fadmin%2Fmedia');
});

const { ResourceConsole } = await import('../app/admin/resource-console.tsx');
const { findAdminResource } = await import('../lib/admin/resources.ts');
function mountResource(slug, items=[], total=String(items.length), params='') {
  return render(React.createElement(AppRouterContext.Provider,{value:{refresh(){refreshed++;},push(path){pushed.push(path);},replace(){},prefetch(){},back(){},forward(){}}},React.createElement(ResourceConsole,{resource:findAdminResource(slug),data:{items,total},params})));
}
test('chain details link to steps and mix while remaining read-only',()=>{
  const ui=mountResource('prompt-chains',[{id:media.id,name:'Factory',description:'Existing workflow',created_at:'2026-10-29'}]);
  assert.equal(ui.queryByRole('button',{name:'Create record'}),null);assert.equal(ui.queryByRole('button',{name:'Edit'}),null);
  assert.equal(ui.getByRole('link',{name:'Steps'}).getAttribute('href'),`/admin/prompt-chain-steps?prompt_chain_id=${media.id}`);
  assert.equal(ui.getByRole('link',{name:'Mix'}).getAttribute('href'),`/admin/prompt-chain-mix?prompt_chain_id=${media.id}`);
  assert.ok(ui.getByText('View full record'));
});
test('mix permits updates without create or delete actions and sends numeric weights',async()=>{
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({id:media.id});};
  const ui=mountResource('prompt-chain-mix',[{id:media.id,prompt_chain_id:admin.id,weight:1,enabled:true,created_at:'2026-10-29'}]);
  assert.equal(ui.queryByRole('button',{name:'Create record'}),null);assert.equal(ui.queryByRole('button',{name:'Delete'}),null);
  fireEvent.click(ui.getByRole('button',{name:'Edit'}));fireEvent.change(ui.getByRole('spinbutton',{name:'Weight'}),{target:{value:'2.5'}});
  fireEvent.change(ui.getByRole('combobox',{name:'Enabled'}),{target:{value:'false'}});
  await act(async()=>{fireEvent.click(ui.getByRole('button',{name:'Save record'}));});
  assert.equal(calls[0].options.method,'PATCH');assert.deepEqual(JSON.parse(calls[0].options.body),{weight:2.5,enabled:false});
});
test('terms create and delete require explicit form actions; conflicts keep confirmation available',async()=>{
  let count=0;const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});count++;return count===2?Response.json({error:'This record is still in use.'},{status:409}):Response.json({id:media.id});};
  const ui=mountResource('terms',[{id:media.id,term:'Wit',definition:'Definition',created_at:'2026-10-29'}]);
  fireEvent.click(ui.getByRole('button',{name:'Create record'}));
  fireEvent.change(ui.getByRole('textbox',{name:'Term',exact:true}),{target:{value:'Irony'}});fireEvent.change(ui.getByRole('textbox',{name:'Definition',exact:true}),{target:{value:'A definition'}});
  await act(async()=>{fireEvent.click(ui.getByRole('button',{name:'Save record'}));});
  assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(calls[0].options.body),{term:'Irony',definition:'A definition'});
  fireEvent.click(ui.getByRole('button',{name:'Delete'}));assert.equal(calls.length,1);
  await act(async()=>{fireEvent.click(ui.getByRole('button',{name:'Permanently delete'}));});
  assert.ok(ui.getByRole('alert'));assert.ok(ui.getByRole('button',{name:'Permanently delete'}));assert.equal(refreshed,1);
});
test('images expose multipart upload and edit details, then refresh after saving',async()=>{
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({id:media.id});};
  const ui=mount('images');fireEvent.click(ui.getByRole('button',{name:'Upload image'}));
  fireEvent.change(ui.getByLabelText('Image file'),{target:{files:[new File(['png'],'image.png',{type:'image/png'})]}});
  fireEvent.change(ui.getByRole('textbox',{name:'Title',exact:true}),{target:{value:'Upload title'}});
  await act(async()=>{fireEvent.submit(ui.getByRole('button',{name:'Save image'}).closest('form'));});
  assert.equal(calls[0].url,'/api/admin/media');assert.ok(calls[0].options.body instanceof FormData);assert.equal(calls[0].options.body.get('title'),'Upload title');assert.equal(calls[0].options.headers,undefined);
  fireEvent.click(ui.getByRole('button',{name:'Edit details'}));fireEvent.change(ui.getByRole('textbox',{name:'Description',exact:true}),{target:{value:'New metadata'}});
  await act(async()=>{fireEvent.click(ui.getByRole('button',{name:'Save details'}));});
  assert.equal(calls[1].options.method,'PATCH');assert.deepEqual(JSON.parse(calls[1].options.body),{title:media.title,description:'New metadata'});assert.equal(refreshed,2);
});

test('steps and models show named links instead of unlabelled foreign keys',()=>{
 const providerId='30000000-0000-4000-8000-000000000001';
 let ui=mountResource('prompt-chain-steps',[{id:media.id,name:'Generate roast',position:0,prompt_chain_id:admin.id,llm_model_id:providerId,system_prompt:'Be specific.',user_prompt:'Use the frames.',chain:{id:admin.id,name:'Live roast'},model_record:{id:providerId,name:'Gemini Flash'},created_at:'2026-10-29T13:00:00Z'}]);
 assert.equal(ui.getByRole('link',{name:'Live roast'}).getAttribute('href'),`/admin/prompt-chains?id=${admin.id}`);
 assert.equal(ui.getByRole('link',{name:'Gemini Flash'}).getAttribute('href'),`/admin/llm-models?id=${providerId}`);
 fireEvent.click(ui.getByText('View full record'));
 assert.ok(ui.getByRole('region',{name:'Step prompts'}).textContent.includes('Be specific.'));
 cleanup();
 ui=mountResource('llm-models',[{id:media.id,name:'Gemini Flash',model_id:'gemini-flash',llm_provider_id:providerId,provider_record:{id:providerId,name:'Google Gemini'},enabled:true}]);
 assert.equal(ui.getByRole('link',{name:'Google Gemini'}).getAttribute('href'),`/admin/llm-providers?id=${providerId}`);
 assert.equal(ui.getByRole('link',{name:'Requests'}).getAttribute('href'),`/admin/generation-requests?llm_model_id=${media.id}`);
});
test('request records display the actual sent prompts and saved mix with links to the correct responses',async()=>{
 const row={id:media.id,user_id:admin.id,source:'getchecked',status:'succeeded',model:'gemini-flash',attempt:1,created_at:'2026-10-29T13:00:00Z',request:{systemInstruction:{parts:[{text:'Recorded system prompt'}]},contents:[{parts:[{text:'Recorded user prompt'}]}],generationConfig:{maxOutputTokens:2048}},prompt_snapshot:{name:'Recorded step'},mix_snapshot:{entry:{weight:3,enabled:true}}};
 const ui=mountResource('generation-requests',[row]);
 fireEvent.click(ui.getByText('View full record'));
 assert.match(ui.getByRole('region',{name:'Recorded input'}).textContent,/Recorded system prompt.*Recorded user prompt.*2048/s);
 assert.match(ui.getByRole('region',{name:'Recorded prompt and mix'}).textContent,/Recorded step.*"weight": 3/s);
 assert.equal(ui.getByRole('link',{name:'LLM responses'}).getAttribute('href'),`/admin/llm-responses?request_id=${media.id}`);
 assert.equal(ui.getByRole('link',{name:'User'}).getAttribute('href'),`/admin/users?search=${admin.id}`);
 assert.match(ui.container.querySelector('time').textContent,/9:00 AM/);
 await act(async()=>{fireEvent.click(ui.getByRole('button',{name:'Refresh records'}));});
 assert.equal(refreshed,1);
});
test('responses show public output, zero duration, usage, and the associated recorded request',()=>{
 const ui=mountResource('llm-responses',[{id:media.id,request_id:admin.id,model:'gemini-flash',status:'succeeded',duration_ms:0,http_status:200,response:{candidates:[{content:{parts:[{thought:true,text:'hidden thought'},{text:'Actual public response'}]}}]},usage:{promptTokenCount:42},request_record:{id:admin.id,source:'getchecked',request:{prompt:'Associated input'},prompt_snapshot:{name:'Saved step'},mix_snapshot:{entry:{weight:2}}}}]);
 fireEvent.click(ui.getByText('View full record'));
 assert.equal(ui.getByRole('link',{name:'View request'}).getAttribute('href'),`/admin/generation-requests?id=${admin.id}`);
 assert.ok(ui.getByText('0 ms'));
 const output=ui.getByRole('region',{name:'Provider result'});
 assert.match(output.textContent,/Actual public response.*42/s);assert.ok(!output.textContent.includes('hidden thought'));
 assert.match(ui.getByRole('region',{name:'Recorded input'}).textContent,/Associated input/);
});
test('empty audit tables are distinguished from filtered results and filters survive pagination',()=>{
 let ui=mountResource('generation-requests');
 assert.ok(ui.getByText('No generation requests have been recorded in this Supabase project yet.'));
 cleanup();
 ui=mountResource('generation-requests',[],'30','status=failed&source=getchecked');
 assert.ok(ui.getByText('No matching records.'));
 assert.equal(ui.getByRole('combobox',{name:'Status'}).value,'failed');
 assert.equal(ui.getByRole('textbox',{name:'Source'}).value,'getchecked');
 assert.equal(ui.getByRole('link',{name:'Next →'}).getAttribute('href'),'/admin/generation-requests?status=failed&source=getchecked&page=2');
});

const {Overview}=await import('../app/admin/overview.tsx');
const {Sidebar}=await import('../app/sidebar.tsx');
const {PathnameContext}=await import('next/dist/shared/lib/hooks-client-context.shared-runtime.js');
test('overview shows real zero values, exact large totals, and the New York month and refreshes on demand',async()=>{
 const data={total_users:'9007199254740993',new_users_this_month:'0',total_memes:'1200',total_egos:'0',month_start:'2026-10-01T04:00:00Z',month_end:'2026-11-01T04:00:00Z',updated_at:'2026-10-29T12:00:00Z'};
 const ui=render(React.createElement(AppRouterContext.Provider,{value:{refresh(){refreshed++;}}},React.createElement(Overview,{data})));
 assert.match(ui.getByRole('article',{name:'Total users'}).textContent,/9,007,199,254,740,993/);
 assert.match(ui.getByRole('article',{name:'New users this month'}).textContent,/0.*October 2026/);
 assert.match(ui.getByRole('article',{name:'Total memes'}).textContent,/1,200/);
 assert.match(ui.getByRole('article',{name:'Total egos'}).textContent,/0.*Published ego uploads/);
 await act(async()=>{fireEvent.click(ui.getByRole('button',{name:'Refresh totals'}));});assert.equal(refreshed,1);
});
test('Overview is the first main admin sidebar link and is active only on the overview page',()=>{
 const mountSidebar=path=>render(React.createElement(PathnameContext.Provider,{value:path},React.createElement(Sidebar,{isAdmin:true})));
 let ui=mountSidebar('/admin');
 assert.equal(ui.getByRole('navigation',{name:'Main navigation'}).querySelector('a').getAttribute('href'),'/admin');
 assert.equal(ui.getByRole('link',{name:'Overview'}).getAttribute('aria-current'),'page');
 cleanup();ui=mountSidebar('/admin/users');assert.equal(ui.getByRole('link',{name:'Overview'}).getAttribute('aria-current'),null);
});
