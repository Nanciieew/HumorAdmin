import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import './admin-test-loader.mjs';
process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SECRET_KEY='fixture';process.env.GEMINI_API_KEY='fixture';process.env.GEMINI_MODEL='fixture-model';process.env.ARK_API_KEY='fixture';
const {supabase}=await import('../lib/supabase.ts');
const {generateFactoryBatch,publishFactoryBatch,readFactoryBatch,previewFactoryBatch,discardFactoryBatch,cleanupFactoryBatches,factoryPath}=await import('../lib/factory/server.ts');
const {parseCaptions}=await import('../lib/factory/captions.ts');
const originalFetch=globalThis.fetch,originalFrom=supabase.from,originalStorage=supabase.storage.from;
const tables={images:new Map(),factory_batches:new Map(),llm_responses:new Map(),generation_requests:new Map()};
const objects=new Map(),removed=[],requests=[];
let failVariant=-1,failRemove=false;
const bytes=await sharp({create:{width:400,height:300,channels:3,background:'#aaa'}}).jpeg().toBuffer();
const image=`data:image/jpeg;base64,${bytes.toString('base64')}`;
const owner=randomUUID(),captions=['My last brain cell has left the chat','When the deadline starts looking back','Me pretending the Wi-Fi caused this','Monday called and I declined','That meeting could have been a nap'];
globalThis.__adminAuthClient={
 auth:{async getUser(){return{data:{user:{id:owner,email:'admin@example.com',email_confirmed_at:'2026-01-01',identities:[{provider:'google'}]}},error:null};}},
 from(){return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:{is_superadmin:true},error:null};}};},
};
class Query {
 filters=[];op='select';values=null;count=Infinity;
 constructor(table){this.rows=tables[table];this.table=table;assert.ok(this.rows,table);}
 select(){return this;} eq(key,value){this.filters.push(row=>row[key]===value);return this;} is(key,value){return this.eq(key,value);} not(key,_op,value){this.filters.push(row=>row[key]!==value);return this;}
 lt(key,value){this.filters.push(row=>row[key]<value);return this;} gt(key,value){this.filters.push(row=>row[key]>value);return this;} in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}
 abortSignal(){return this;} order(){return this;} limit(count){this.count=count;return this;} insert(values){this.op='insert';this.values=values;return this;} update(values){this.op='update';this.values=values;return this;} delete(){this.op='delete';return this;}
 run(single=false){
  let rows=[...this.rows.values()].filter(row=>this.filters.every(fn=>fn(row))).slice(0,this.count);
  if(this.op==='insert'){
   if(this.table==='llm_responses')this.values={id:randomUUID(),...this.values};
   if(this.rows.has(this.values.id)||(this.table==='factory_batches'&&[...this.rows.values()].some(row=>row.user_id===this.values.user_id&&row.state==='generating')))return{data:null,error:{code:'23505'}};
   const row=this.table==='factory_batches'?{state:'generating',variants:[],selected:null,lease_until:null,cleaned_at:null,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),...this.values}:{published_at:null,original_storage_path:null,created_at:new Date().toISOString(),...this.values};
   this.rows.set(row.id,row);rows=[row];
  } else if(this.op==='update')for(const row of rows)Object.assign(row,this.values);
  else if(this.op==='delete')for(const row of rows)this.rows.delete(row.id);
  return{data:structuredClone(single?(rows[0]??null):rows),error:null};
 }
 single(){return Promise.resolve(this.run(true));}maybeSingle(){return this.single();}then(resolve,reject){return Promise.resolve(this.run()).then(resolve,reject);}
}
const originalRpc=supabase.rpc;
supabase.rpc=(name,args)=>({abortSignal:async()=>{
 if(name==='record_generation_start'){tables.generation_requests.set(args.p_entry.id,args.p_entry);return{data:args.p_entry.id,error:null};}
 assert.equal(name,'record_generation_finish');
 const entry=tables.generation_requests.get(args.p_id);
 tables.llm_responses.set(args.p_id,{request_id:args.p_id,generation_request_id:entry.factory_batch_id,model:entry.model,response:args.p_result.response});
 return{data:null,error:null};
}});
after(()=>{supabase.rpc=originalRpc;});
supabase.from=table=>new Query(table);
supabase.storage.from=bucket=>({
 async upload(path,data){if(path.endsWith(`/${failVariant}.webp`))return{error:{message:'Failed'}};objects.set(`${bucket}/${path}`,Buffer.from(data));return{error:null};},
 async remove(paths){if(failRemove)return{error:{message:'Failed'}};for(const path of paths){removed.push(`${bucket}/${path}`);objects.delete(`${bucket}/${path}`);}return{error:null};},
 async download(path){const value=objects.get(`${bucket}/${path}`);return value?{data:new Blob([value],{type:'image/webp'}),error:null}:{data:null,error:{}};},
 async createSignedUrl(path){return{data:{signedUrl:`https://fixture.supabase.co/${bucket}/${path}`},error:null};}
});
beforeEach(()=>{
 for(const rows of Object.values(tables))rows.clear();objects.clear();removed.length=0;requests.length=0;failVariant=-1;failRemove=false;
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('generateContent')){requests.push({provider:'captions',body:JSON.parse(options.body)});return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({captions})}]}}]});}
  throw new Error('The factory must not call an image generator or download a replacement image.');
 };
});
after(()=>{supabase.from=originalFrom;supabase.storage.from=originalStorage;globalThis.fetch=originalFetch;});
const generate=async()=>{const id=randomUUID();return generateFactoryBatch(owner,{id,image,direction:'Finals week',approved:true});};
test('invalid input never calls either provider; malformed or duplicate caption sets fail',async()=>{
 for(const body of [{id:randomUUID(),image,direction:''},{id:randomUUID(),image:'https://outside.test/a.jpg',direction:'',approved:true}])await assert.rejects(generateFactoryBatch(owner,body));
 assert.equal(requests.length,0);assert.equal(tables.factory_batches.size,0);
 for(const value of [{captions:['one']},{captions:Array(5).fill('same')},{captions:[...captions.slice(0,4),'x'.repeat(181)]}])assert.throws(()=>parseCaptions(value));
});
test('five captions produce five cached overlays on the unchanged original, with no image-provider calls',async()=>{
 const result=await generate();assert.equal(result.variants.length,5);assert.equal(tables.images.size,0);assert.equal(objects.size,6);
 assert.deepEqual(result.variants.map(variant=>variant.caption),captions);
 assert.equal(requests.filter(call=>call.provider==='captions').length,1);
 assert.equal(requests.length,1);
 const [logged]=[...tables.llm_responses.values()];
 assert.equal(logged.generation_request_id,result.id);assert.equal(logged.model,'fixture-model');
 assert.deepEqual(JSON.parse(logged.response.candidates[0].content.parts[0].text),{captions});
 assert.ok(!JSON.stringify(logged).includes('inlineData'));
 const original=await sharp(bytes).ensureAlpha().raw().toBuffer();
 for(let index=0;index<5;index++){
  const cached=objects.get(`generated-images/${factoryPath(owner,result.id,index)}`);
  const decoded=await sharp(cached).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(decoded.info.width,400);assert.equal(decoded.info.height,300);
  assert.deepEqual(decoded.data.subarray(0,400*200*4),original.subarray(0,400*200*4),'all pixels above the bottom caption area stay unchanged');
 }

 const repeated=await generateFactoryBatch(owner,{id:result.id,image,direction:'',approved:true});assert.equal(repeated.id,result.id);assert.equal(requests.length,1);
});
test('publishing keeps the selected image, deletes the other four, and retries without duplicates',async()=>{
 const batch=await generate();const selected=2;
 const result=await publishFactoryBatch(owner,batch.id,selected);assert.equal(result.photoId,batch.id);
 assert.equal(tables.images.size,1);assert.equal(tables.images.get(batch.id).description,captions[selected]);assert.ok(tables.images.get(batch.id).published_at);
 assert.ok(objects.has(`generated-images/${factoryPath(owner,batch.id,selected)}`));
 for(const index of [0,1,3,4])assert.equal(objects.has(`generated-images/${factoryPath(owner,batch.id,index)}`),false);
 assert.deepEqual(objects.get(`gallery-photos/${tables.images.get(batch.id).public_storage_path}`),objects.get(`generated-images/${factoryPath(owner,batch.id,selected)}`),'publication copies the exact lossless rendered bytes');
 assert.equal(objects.size,3);await publishFactoryBatch(owner,batch.id,selected);assert.equal(objects.size,3);
 await assert.rejects(publishFactoryBatch(owner,batch.id,0),/already been published/);
 assert.equal(requests.length,1);
});
test('cross-account reads and publications cannot reveal or delete another batch',async()=>{
 const batch=await generate(),other=randomUUID();
 await assert.rejects(readFactoryBatch(other,batch.id),/not found/);
 await assert.rejects(publishFactoryBatch(other,batch.id,0),/not found/);
 await assert.rejects(discardFactoryBatch(other,batch.id),/not found/);assert.equal(objects.size,6);
});
test('one failed image waits for siblings then deletes all partial outputs',async()=>{
 failVariant=2;await assert.rejects(generate(),/cache a meme/);assert.equal(objects.size,0);assert.equal(tables.images.size,0);
 assert.ok([...tables.factory_batches.values()].every(batch=>batch.state==='discarded'));
});
test('concurrent differing selections publish only one keeper',async()=>{
 const batch=await generate();const results=await Promise.allSettled([publishFactoryBatch(owner,batch.id,0),publishFactoryBatch(owner,batch.id,1)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(tables.images.size,1);assert.equal(objects.size,3);
});
test('cleanup failure after publishing is safely retryable without deleting the selected original',async()=>{
 const batch=await generate();failRemove=true;await assert.rejects(publishFactoryBatch(owner,batch.id,3),/cleanup is pending/);
 assert.equal(tables.factory_batches.get(batch.id).state,'published');assert.ok(tables.images.get(batch.id).published_at);
 assert.equal((await previewFactoryBatch(await readFactoryBatch(owner,batch.id))).photoId,undefined,'restoring a batch never reports unfinished cleanup as complete');
 failRemove=false;await publishFactoryBatch(owner,batch.id,3);assert.equal(objects.size,3);assert.ok(objects.has(`generated-images/${factoryPath(owner,batch.id,3)}`));
});
test('expiration removes abandoned batches and preserves published memes',async()=>{
 const abandoned=await generate();await discardFactoryBatch(owner,abandoned.id);assert.equal(objects.size,0);
 const published=await generate();await publishFactoryBatch(owner,published.id,4);
 for(const batch of tables.factory_batches.values())batch.expires_at='2000-01-01T00:00:00Z';
 await cleanupFactoryBatches();assert.equal(tables.factory_batches.size,0);assert.equal(tables.images.size,1);assert.equal(objects.size,3);
 assert.ok(objects.has(`generated-images/${factoryPath(owner,published.id,4)}`));
});

test('manual captions render and publish one variant without a configured AI provider, retaining the exact original',async()=>{
 const key=process.env.GEMINI_API_KEY,model=process.env.GEMINI_MODEL;
 delete process.env.GEMINI_API_KEY;delete process.env.GEMINI_MODEL;
 try {
  const id=randomUUID(),caption='Me leaving the group chat';
  const batch=await generateFactoryBatch(owner,{id,image,direction:'',mode:'manual',caption,approved:true});
  assert.equal(batch.variants.length,1);assert.equal(batch.variants[0].caption,caption);assert.equal(requests.length,0);
  await assert.rejects(publishFactoryBatch(owner,id,1),/not ready/);
  assert.equal((await publishFactoryBatch(owner,id,0)).photoId,id);
  assert.equal(tables.images.get(id).description,caption);
  assert.deepEqual(objects.get(`generated-images/${tables.images.get(id).original_storage_path}`),bytes);
  for(const row of tables.factory_batches.values())row.expires_at='2000-01-01T00:00:00Z';
  await cleanupFactoryBatches();
  assert.deepEqual(objects.get(`generated-images/${tables.images.get(id).original_storage_path}`),bytes);
 } finally {process.env.GEMINI_API_KEY=key;process.env.GEMINI_MODEL=model;}
});

test('invalid manual captions fail without provider calls or retained uploads',async()=>{
 for(const caption of ['', 'x'.repeat(181), 'a'.repeat(90)]) {
  await assert.rejects(generateFactoryBatch(owner,{id:randomUUID(),image,direction:'',mode:'manual',caption,approved:true}));
 }
 assert.equal(requests.length,0);assert.equal(objects.size,0);
});

test('Media caption batches update the original record, survive cleanup retries, and retain the original for its owner',async()=>{
 const mediaId=randomUUID(),mediaOwner=randomUUID(),caption='Me leaving the group chat';
 const row={id:mediaId,contributor_id:mediaOwner,source:'generated',private_storage_path:`${mediaOwner}/before.webp`,public_storage_path:`${mediaOwner}/before-public.webp`,published_at:'2026-01-01T00:00:00Z',original_storage_path:null,title:'Old caption',description:'Old caption',upvotes:'9',downvotes:'2'};
 tables.images.set(mediaId,row);
 const id=randomUUID();
 const batch=await generateFactoryBatch(owner,{id,image,direction:'',mode:'manual',caption,approved:true,mediaId});
 assert.equal(batch.mediaId,mediaId);assert.equal(row.description,'Old caption');assert.equal(tables.images.size,1);
 failRemove=true;await assert.rejects(publishFactoryBatch(owner,id,0),/cleanup is pending/);
 assert.equal(row.description,caption);assert.equal(row.contributor_id,mediaOwner);assert.equal(row.upvotes,'9');assert.equal(row.downvotes,'2');assert.equal(row.published_at,'2026-01-01T00:00:00Z');
 assert.equal((await previewFactoryBatch(await readFactoryBatch(owner,id))).photoId,undefined);
 failRemove=false;
 assert.equal((await publishFactoryBatch(owner,id,0)).photoId,mediaId);
 assert.equal((await previewFactoryBatch(await readFactoryBatch(owner,id))).photoId,mediaId);
 assert.equal(tables.images.size,1);
 assert.deepEqual(objects.get(`generated-images/${mediaOwner}/originals/${mediaId}`),bytes);
 const kept=objects.get(`generated-images/${row.private_storage_path}`);
 assert.deepEqual(kept,objects.get(`gallery-photos/${row.public_storage_path}`));
 for(const batch of tables.factory_batches.values())batch.expires_at='2000-01-01T00:00:00Z';
 await cleanupFactoryBatches();
 assert.equal(tables.factory_batches.size,0);assert.equal(tables.images.size,1);
 assert.deepEqual(objects.get(`generated-images/${row.private_storage_path}`),kept);
 assert.deepEqual(objects.get(`generated-images/${mediaOwner}/originals/${mediaId}`),bytes);
});

test('shared Humor Project originals drive regenerated memes and survive repeated edits and both projects’ preview cleanup',async()=>{
 const mediaId=randomUUID(),mediaOwner=randomUUID(),sourcePath=`${mediaOwner}/factory/${mediaId}/original.jpg`;
 const original=await sharp({create:{width:400,height:300,channels:3,background:'#229933'}}).jpeg().toBuffer();
 const row={id:mediaId,contributor_id:mediaOwner,source:'generated',private_storage_path:factoryPath(mediaOwner,mediaId,0),public_storage_path:`${mediaOwner}/old-public.webp`,original_storage_path:sourcePath,published_at:'2026-01-01T00:00:00Z',title:'Old joke',description:'Old joke',upvotes:'9',downvotes:'2'};
 tables.images.set(mediaId,row);objects.set(`generated-images/${sourcePath}`,original);
 const storedOriginal=objects.get(`generated-images/${sourcePath}`);
 tables.factory_batches.set(mediaId,{id:mediaId,user_id:mediaOwner,state:'published',variants:[{caption:'Old joke',path:row.private_storage_path}],selected:0,lease_until:null,original_storage_path:sourcePath,expires_at:new Date(Date.now()+86400000).toISOString()});
 for(const mode of ['ai','manual']) {
  const caption=mode==='ai'?captions[0]:'Me leaving the group chat';
  const id=randomUUID();
  const result=await generateFactoryBatch(owner,{id,image,direction:'',mode,caption,approved:true,mediaId});
  assert.equal(result.mediaId,mediaId);
  if(mode==='ai')assert.equal(requests.at(-1).body.contents[0].parts[1].inlineData.data,original.toString('base64'));
  const rendered=objects.get(`generated-images/${factoryPath(owner,id,0)}`);
  const decoded=await sharp(rendered).ensureAlpha().raw().toBuffer(),source=await sharp(original).ensureAlpha().raw().toBuffer();
  assert.deepEqual(decoded.subarray(0,400*200*4),source.subarray(0,400*200*4),'render from the stored original, ignoring a different client-supplied photo');
  assert.equal((await publishFactoryBatch(owner,id,0)).photoId,mediaId);
  assert.equal(row.original_storage_path,sourcePath);assert.equal(row.contributor_id,mediaOwner);assert.equal(row.upvotes,'9');assert.equal(row.downvotes,'2');
  assert.equal(objects.get(`generated-images/${sourcePath}`),storedOriginal);
 }
 for(const batch of tables.factory_batches.values())batch.expires_at='2000-01-01T00:00:00Z';
 await cleanupFactoryBatches();
 assert.equal(tables.images.size,1);assert.equal(row.original_storage_path,sourcePath);
 assert.equal(objects.get(`generated-images/${sourcePath}`),storedOriginal);
 assert.deepEqual(storedOriginal,original);
});

test('a request logging outage prevents the paid call and cleans the batch',async()=>{
 const saved=supabase.rpc;
 supabase.rpc=()=>({abortSignal:async()=>({error:{code:'unavailable'}})});
 try{await assert.rejects(generate(),/logging is unavailable/);assert.equal(requests.length,0);assert.equal(tables.llm_responses.size,0);}
 finally{supabase.rpc=saved;}
});
