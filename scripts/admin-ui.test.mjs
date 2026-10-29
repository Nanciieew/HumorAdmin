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
