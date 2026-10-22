import assert from 'node:assert/strict';
import {after,beforeEach,test} from 'node:test';
import sharp from 'sharp';
process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SECRET_KEY='fixture-key';
const originalKey=process.env.ARK_API_KEY;process.env.ARK_API_KEY='fixture-ark-key';
const {supabase}=await import('../lib/supabase.ts');
const {generateSeedreamImage}=await import('../lib/seedream-generation.ts');
const originalFetch=globalThis.fetch,originalFrom=supabase.from,originalStorage=supabase.storage.from;
const bytes=await sharp({create:{width:40,height:40,channels:3,background:'#aaa'}}).jpeg().toBuffer();
const image=`data:image/jpeg;base64,${bytes.toString('base64')}`;let saved,requests;
supabase.from=table=>{assert.equal(table,'images');return{insert:async row=>{saved=row;return{error:null};}};};
supabase.storage.from=bucket=>{assert.equal(bucket,'generated-images');return{upload:async()=>({error:null}),remove:async()=>({error:null}),createSignedUrl:async path=>({data:{signedUrl:`https://fixture.supabase.co/${path}`},error:null})};};
beforeEach(()=>{saved=null;requests=[];globalThis.fetch=async(url,options)=>{
 requests.push({url,options});if(String(url).includes('/images/generations'))return Response.json({data:[{url:'https://fixture.volces.com/generated.jpg'}]});
 return new Response(bytes,{headers:{'content-type':'image/jpeg'}});
};});
after(()=>{globalThis.fetch=originalFetch;supabase.from=originalFrom;supabase.storage.from=originalStorage;if(originalKey===undefined)delete process.env.ARK_API_KEY;else process.env.ARK_API_KEY=originalKey;});
test('disguise requests require a validated selfie and explicit provider consent before inference',async()=>{
 for(const body of [{purpose:'disguise',prompt:'Anime',image},{purpose:'disguise',prompt:'Anime',approved:true},{purpose:'disguise',prompt:'Anime',approved:true,image:'https://outside.example/selfie.png'}])await assert.rejects(generateSeedreamImage('owner',body));
 assert.equal(requests.length,0);
});
test('the connected Seedream model receives the photo and direction, and saves only a private output',async()=>{
 const result=await generateSeedreamImage('owner',{purpose:'disguise',approved:true,image,prompt:'Clay superhero.'});
 const body=JSON.parse(requests[0].options.body);assert.equal(body.model,'doubao-seedream-5-0-flash-260915');assert.equal(body.image,image);assert.equal(body.size,'2K');assert.ok(body.prompt.includes('Clay superhero.'));assert.ok(body.prompt.includes('recognizable facial features'));assert.equal(requests[0].options.headers.Authorization,'Bearer fixture-ark-key');
 assert.equal(saved.contributor_id,'owner');assert.equal(saved.source,'generated');assert.ok(saved.private_storage_path);assert.equal(saved.public_storage_path,undefined);assert.equal(result.generationId,saved.id);
});
test('ordinary text-to-image requests retain their existing behavior',async()=>{
 await generateSeedreamImage('owner',{prompt:'A clay spaceship.'});const body=JSON.parse(requests[0].options.body);assert.equal(body.prompt,'A clay spaceship.');assert.equal(body.image,undefined);
});
test('quota, provider access and malformed outputs remain explicit errors without saving a result',async()=>{
 for(const [status,response,expected] of [[429,{},/quota/],[403,{},/rejected/],[400,{error:{code:'SetLimitExceeded'}},/usage limit/],[200,{data:[]},/no usable image/]]){
  globalThis.fetch=async()=>Response.json(response,{status});await assert.rejects(generateSeedreamImage('owner',{purpose:'disguise',approved:true,image,prompt:'Anime'}),expected);assert.equal(saved,null);
 }
});
