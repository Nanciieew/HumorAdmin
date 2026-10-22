import assert from 'node:assert/strict';
import {afterEach,test} from 'node:test';
import {JSDOM} from 'jsdom';
import React from 'react';
import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import {PathnameContext,SearchParamsContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost:3000/disguise'});
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','MutationObserver','Node','Event','MouseEvent','getComputedStyle','FileReader','sessionStorage'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
globalThis.self=dom.window;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {DisguiseStudio}=await import('../app/disguise/studio.tsx');
const {setDisguiseDraft,peekDisguiseDraft,clearDisguiseDraft}=await import('../lib/disguise-draft.ts');
const originalFetch=globalThis.fetch;
afterEach(()=>{cleanup();sessionStorage.clear();globalThis.fetch=originalFetch;const d=peekDisguiseDraft();if(d)clearDisguiseDraft(d.image);});
const draft=()=>setDisguiseDraft('/9j/AA==');
const id='30000000-0000-4000-8000-000000000001';
const preview={id,selected:null,expiresAt:new Date(Date.now()+86400000).toISOString(),variants:Array.from({length:5},(_,i)=>({caption:`Caption ${i+1}`,url:`https://fixture.supabase.co/meme-${i+1}.webp`}))};
function setup({configured=true,path='/disguise'}={}){
 function Harness(){
  const [pathname,setPathname]=React.useState(path);
  const router=React.useMemo(()=>({push:setPathname,replace:setPathname}),[]);
  return React.createElement(AppRouterContext.Provider,{value:router},React.createElement(SearchParamsContext.Provider,{value:new URLSearchParams(pathname.split('?')[1])},React.createElement(PathnameContext.Provider,{value:pathname.split('?')[0]},React.createElement(DisguiseStudio,{configured,userId:'tester',galleryUrl:'https://original.example/gallery'}))));
 }
 return render(React.createElement(Harness));
}
const generateButton=ui=>ui.getByRole('button',{name:'Create meme'});
async function generate(ui){fireEvent.click(generateButton(ui));await waitFor(()=>assert.ok(ui.getByRole('button',{name:/01\s*Caption 1/})));}
test('Create meme opens a separate preview screen; five captions switch to matching cached captioned images without another call',async()=>{
 draft();const requests=[];let resolve;
 globalThis.fetch=(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return new Promise(r=>resolve=r);};
 const ui=setup();assert.equal(peekDisguiseDraft(),null);assert.equal(generateButton(ui).disabled,false);assert.equal(requests.length,0);
 assert.equal(ui.queryByRole('heading',{name:'Pick your caption'}),null);assert.equal(ui.queryByRole('checkbox'),null);
 fireEvent.change(ui.getByLabelText(/Keyword/),{target:{value:'Finals week'}});
 const button=generateButton(ui);fireEvent.click(button);fireEvent.click(button);assert.equal(requests.length,1);
 assert.equal(requests[0].url,'/api/factory');assert.equal(requests[0].body.direction,'Finals week');assert.equal(requests[0].body.image,'data:image/jpeg;base64,/9j/AA==');assert.equal(requests[0].body.approved,true);
 assert.ok(ui.getByRole('dialog',{name:'Creating your memes'}));assert.equal(generateButton(ui).disabled,true);
 assert.equal(ui.queryByRole('heading',{name:'Pick your caption'}),null);
 await act(async()=>resolve(Response.json(preview)));
 for(let index=0;index<5;index++){
  const button=ui.getByRole('button',{name:new RegExp(`0${index+1}\\s*Caption ${index+1}`)});fireEvent.click(button);
  assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(ui.getByAltText(`Meme preview: Caption ${index+1}`).getAttribute('src'),preview.variants[index].url);
 }
 assert.equal(requests.length,1,'switching captions reuses the cached images');
});
test('Publish to gallery confirms the selected caption, locks selection, and reports cleanup',async()=>{
 draft();const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,...JSON.parse(options.body)});return Response.json(url==='/api/factory'?preview:{photoId:id});};
 const ui=setup();await generate(ui);fireEvent.click(ui.getByRole('button',{name:/03\s*Caption 3/}));
 const publish=ui.getByRole('button',{name:'Publish to gallery'});assert.equal(publish.disabled,false);assert.equal(calls.length,1);
 fireEvent.click(publish);fireEvent.click(publish);
 await waitFor(()=>assert.ok(ui.getByRole('link',{name:'View in gallery'})));
 assert.deepEqual(calls[1],{url:`/api/factory/${id}`,selected:2,approved:true});assert.equal(calls.length,2);
 assert.equal(ui.queryByText('Published. This one’s a keeper.'),null);
 assert.ok(ui.getByRole('status',{name:'Meme published. CHECKED'}));
 assert.equal(ui.getByRole('button',{name:/04\s*Caption 4/}).disabled,true);
 assert.equal(ui.getByRole('link',{name:'View in gallery'}).getAttribute('href'),`https://original.example/gallery?sort=newest#photo-${id}`);
});
test('upload validates locally and previews without AI calls',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Unexpected request');};
 const ui=setup(),input=ui.container.querySelector('input[type=file]');
 fireEvent.change(input,{target:{files:[new dom.window.File(['fixture'],'meme.png',{type:'image/png'})]}});
 await waitFor(()=>assert.ok(ui.getByAltText('Your uploaded meme picture')));assert.equal(calls,0);
 assert.equal(generateButton(ui).disabled,false);
 fireEvent.change(input,{target:{files:[new dom.window.File(['bad'],'meme.webp',{type:'image/webp'})]}});
 await waitFor(()=>assert.ok(ui.getByText('Choose a JPG or PNG meme picture up to 2 MB.')));
 assert.equal(generateButton(ui).disabled,true);assert.equal(calls,0);
});
test('cancelling discards the private batch and ignores a late model response',async()=>{
 draft();let resolve;const calls=[];
 globalThis.fetch=(url,options)=>{calls.push({url,method:options.method});return options.method==='DELETE'?Promise.resolve(Response.json({ok:true})):new Promise(r=>resolve=r);};
 const ui=setup();fireEvent.click(generateButton(ui));fireEvent.click(ui.getByRole('button',{name:'Cancel'}));
 await act(async()=>resolve(Response.json(preview)));
 assert.equal(ui.queryByAltText('Meme preview: Caption 1'),null);assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
});
test('publication failure allows retry of the confirmed caption and never claims cleanup succeeded early',async()=>{
 draft();let publishes=0;globalThis.fetch=async(url)=>url==='/api/factory'?Response.json(preview):++publishes===1?Response.json({error:'Cleanup pending.'},{status:503}):Response.json({photoId:id});
 const ui=setup();await generate(ui);fireEvent.click(ui.getByRole('button',{name:'Publish to gallery'}));
 await waitFor(()=>assert.ok(ui.getByText('Cleanup pending.')));assert.equal(ui.queryByText('Published. This one’s a keeper.'),null);
 assert.equal(ui.getByRole('button',{name:/02\s*Caption 2/}).disabled,true);
 fireEvent.click(ui.getByRole('button',{name:'Retry publishing'}));await waitFor(()=>assert.ok(ui.getByRole('link',{name:'View in gallery'})));assert.equal(publishes,2);assert.ok(ui.getByRole('status',{name:'Meme published. CHECKED'}));
});
test('cached batch restores after remount without generating again; missing configuration blocks paid requests',async()=>{
 sessionStorage.setItem('checked:factory-batch:tester',id);let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,`/api/factory/${id}`);assert.equal(options.method,undefined);return Response.json(preview);};
 const ui=setup({path:'/disguise/preview'});await waitFor(()=>assert.ok(ui.getByAltText('Meme preview: Caption 1')));assert.equal(calls,1);ui.unmount();sessionStorage.clear();
 draft();const missing=setup({configured:false});assert.equal(generateButton(missing).disabled,true);
});
test('drag-and-drop selects a picture locally and leaves keyword optional',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Unexpected request');};
 const ui=setup(),zone=ui.getByRole('group',{name:'Photo upload'});
 fireEvent.dragOver(zone);
 assert.ok(ui.getByText('Drop it here'));
 fireEvent.drop(zone,{dataTransfer:{files:[new dom.window.File(['fixture'],'dropped.png',{type:'image/png'})]}});
 await waitFor(()=>assert.ok(ui.getByAltText('Your uploaded meme picture')));
 assert.equal(ui.getByLabelText(/Keyword/).value,'');assert.equal(generateButton(ui).disabled,false);assert.equal(calls,0);
 assert.equal(ui.queryByText(/Send this picture to/),null);
});
test('back to upload separates the screens and does not discard a recoverable preview',async()=>{
 draft();const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method});return Response.json(preview);};
 const ui=setup();await generate(ui);
 assert.ok(ui.getByRole('heading',{name:'Pick your caption'}));
 fireEvent.click(ui.getByRole('button',{name:'Back to upload'}));
 assert.ok(ui.getByRole('button',{name:'Create meme'}));assert.equal(ui.queryByRole('heading',{name:'Pick your caption'}),null);
 assert.equal(calls.filter(call=>call.method==='DELETE').length,0);
});


test('Create Another Meme clears the published batch and returns to an empty upload screen',async()=>{
 draft();const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method});return Response.json(url==='/api/factory'?preview:{photoId:id});};
 const ui=setup();await generate(ui);fireEvent.click(ui.getByRole('button',{name:'Publish to gallery'}));
 await waitFor(()=>assert.ok(ui.getByRole('button',{name:'Create Another Meme'})));
 const actions=ui.getByRole('button',{name:'Create Another Meme'}).parentElement;
 assert.equal(actions.firstElementChild.textContent,'Create Another Meme');assert.match(actions.lastElementChild.textContent,/View in gallery/);
 fireEvent.click(ui.getByRole('button',{name:'Create Another Meme'}));
 assert.ok(ui.getByRole('button',{name:'Upload photo'}));assert.equal(generateButton(ui).disabled,true);
 assert.equal(ui.getByLabelText(/Keyword/).value,'');assert.equal(sessionStorage.getItem('checked:factory-batch:tester'),null);
 assert.equal(ui.queryByRole('status',{name:'Meme published. CHECKED'}),null);assert.equal(calls.length,2);
});

test('Precision Lab success window closes back to the published preview without generating again',async()=>{
 draft();let calls=0;globalThis.fetch=async url=>{calls++;return Response.json(url==='/api/factory'?preview:{photoId:id});};
 const ui=setup();await generate(ui);fireEvent.click(ui.getByRole('button',{name:'Publish to gallery'}));
 await waitFor(()=>assert.ok(ui.getByRole('dialog',{name:'Meme published'}).open));
 fireEvent.click(ui.getByRole('button',{name:'Close success window'}));
 assert.equal(ui.queryByRole('dialog',{name:'Meme published'}),null);
 assert.ok(ui.getByRole('link',{name:'View in gallery'}));assert.equal(calls,2);
});

test('manual captions work without AI configuration and preview a single rendered option',async()=>{
 draft();const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({...preview,variants:[{caption:'My own joke',url:preview.variants[0].url}]});};
 const ui=setup({configured:false});fireEvent.click(ui.getByRole('button',{name:'Write my own caption'}));
 fireEvent.change(ui.getByLabelText('Your caption'),{target:{value:'My own joke'}});
 assert.equal(generateButton(ui).disabled,false);fireEvent.click(generateButton(ui));
 await waitFor(()=>assert.ok(ui.getByRole('heading',{name:'Your caption'})));
 assert.equal(calls.length,1);assert.equal(calls[0].body.mode,'manual');assert.equal(calls[0].body.caption,'My own joke');
 assert.ok(ui.getByAltText('Meme preview: My own joke'));assert.ok(ui.getByText('1 / 1'));
});

test('Media edits automatically load the original and save the selected caption back to the existing meme',async()=>{
 const mediaId='40000000-0000-4000-8000-000000000001',calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/original'))return Response.json({image:'data:image/png;base64,AA==',caption:'Existing joke'});
  return Response.json(url==='/api/factory'?{...preview,mediaId}:{photoId:mediaId});
 };
 const ui=setup({path:`/disguise?media=${mediaId}`});
 await waitFor(()=>assert.ok(ui.getByAltText('Your uploaded meme picture')));
 assert.equal(calls.length,1);assert.equal(calls[0].url,`/api/admin/media/${mediaId}/original`);
 fireEvent.click(ui.getByRole('button',{name:'Write my own caption'}));assert.equal(ui.getByLabelText('Your caption').value,'Existing joke');
 fireEvent.click(ui.getByRole('button',{name:'Generate with AI'}));
 await generate(ui);
 assert.equal(JSON.parse(calls[1].options.body).mediaId,mediaId);
 fireEvent.click(ui.getByRole('button',{name:'Save caption'}));
 await waitFor(()=>assert.ok(ui.getByRole('link',{name:'Back to Media'})));
 assert.equal(ui.getByRole('link',{name:'Back to Media'}).getAttribute('href'),'/admin/media');
 assert.ok(ui.getByRole('status',{name:'Caption saved. CHECKED'}));
});

test('legacy memes ask for the caption-free original rather than loading the flattened meme',async()=>{
 globalThis.fetch=async()=>Response.json({image:null,caption:'Old joke'});
 const ui=setup({path:'/disguise?media=40000000-0000-4000-8000-000000000001'});
 await waitFor(()=>assert.ok(ui.getByText(/original photo wasn’t saved/)));
 assert.equal(ui.queryByAltText('Your uploaded meme picture'),null);assert.equal(generateButton(ui).disabled,true);
});
