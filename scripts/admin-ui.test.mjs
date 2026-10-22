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
  return render(React.createElement(AppRouterContext.Provider,{value:{refresh(){refreshed++;},push(path){pushed.push(path);},replace(){},prefetch(){},back(){},forward(){}}},React.createElement(AdminConsole,{section,admin,data:{items,total},params})));
}
afterEach(async()=>{await act(async()=>{});cleanup();globalThis.fetch=originalFetch;refreshed=0;pushed=[];});
test('users and ratings remain read-only, include pending accounts and page through records',()=>{
  const user={id:admin.id,email:admin.email,account_created_at:'2026-10-20T12:00:00Z',profile_created_at:null,first_name:null,last_name:null,state_code:null,onboarding_completed_at:null,is_superadmin:false};
  const ui=mount('users',[user],'30');
  assert.ok(ui.getByText('Awaiting profile'));assert.ok(ui.getByText('Onboarding pending'));
  assert.equal(ui.queryByRole('button',{name:'Delete'}),null);assert.equal(ui.queryByRole('button',{name:'Save captions'}),null);
  assert.equal(ui.getByRole('link',{name:'Next →'}).getAttribute('href'),'/admin/users?page=2');
  cleanup();const votes=mount('votes',[{photo_id:media.id,title:'A meme',voter_id:admin.id,voter_name:'Reader',value:-1}]);
  assert.ok(votes.getByText('↓ Downvote'));assert.equal(votes.queryByRole('button',{name:'Delete'}),null);
});
test('media previews use protected endpoints and caption saves submit only editable fields',async()=>{
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({id:media.id});};
  const ui=mount();assert.equal(ui.getByRole('img').getAttribute('src'),`/api/admin/media/${media.id}/preview`);
  fireEvent.change(ui.getByLabelText(`Title for ${media.id}`),{target:{value:'Edited meme'}});
  await act(async()=>{fireEvent.click(ui.getByRole('button',{name:'Save captions'}));});
  assert.equal(refreshed,1);
  assert.equal(calls[0].options.method,'PATCH');assert.deepEqual(JSON.parse(calls[0].options.body),{title:'Edited meme',description:'A caption'});
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
test('creation searches completed owners, supports AI generation, and defaults to private',async()=>{
  const owner={...admin,id:'10000000-0000-4000-8000-000000000002',email:'other@example.com',first_name:'Other',last_name:'Owner'};
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(String(url).startsWith('/api/admin/users')?{items:[owner],total:'1'}:{id:media.id});};
  const ui=mount();fireEvent.click(ui.getByText('Create media'));
  fireEvent.change(ui.getByLabelText('Find another owner'),{target:{value:'other'}});fireEvent.click(ui.getByRole('button',{name:'Find owner'}));
  await waitFor(()=>assert.ok(ui.getByRole('option',{name:/other@example.com/})));
  assert.match(calls[0].url,/completed=true/);
  fireEvent.change(ui.getByLabelText('Owner'),{target:{value:owner.id}});
  fireEvent.change(ui.getByLabelText('Create with'),{target:{value:'generate'}});
  fireEvent.change(ui.getByLabelText('Generation prompt'),{target:{value:'A funny robot'}});
  fireEvent.submit(ui.getByRole('form',{name:'Create media'}));
  await waitFor(()=>assert.equal(refreshed,1));
  assert.equal(calls[1].url,'/api/admin/media/generate');assert.deepEqual(JSON.parse(calls[1].options.body),{owner:owner.id,title:'',description:'',prompt:'A funny robot'});
  assert.ok(ui.getByText('Generated image saved privately. Publish it when ready.'));
});
test('publishing uses its explicit action; expired sessions return to Google login',async()=>{
  let count=0;globalThis.fetch=async()=>{count++;return count===1?Response.json({id:media.id}):Response.json({error:'Sign in with Google to continue.'},{status:401});};
  const ui=mount();await act(async()=>{fireEvent.click(ui.getByRole('button',{name:'Publish'}));});assert.equal(refreshed,1);
  await waitFor(()=>assert.equal(ui.getByRole('button',{name:'Save captions'}).disabled,false));
  await act(async()=>{fireEvent.click(ui.getByRole('button',{name:'Save captions'}));});assert.equal(pushed[0],'/login?next=%2Fadmin%2Fmedia');
});
