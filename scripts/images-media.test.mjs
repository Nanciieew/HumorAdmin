import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

// Isolated database/storage doubles: the real media code runs without live credentials.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fixture-key';
const { supabase } = await import('../lib/supabase.ts');
const { publishGalleryImage, saveGeneratedImage, normalizeGalleryImage, cleanupGalleryStaging } = await import('../lib/gallery-media.ts');
const originalFrom = supabase.from;
const originalStorage = supabase.storage.from;
const originalFetch = globalThis.fetch;
const tables = { images: new Map(), gallery_uploads: new Map() };
const objects = new Map(); const removed = [];
let failSave = false;
const owner = randomUUID();
const png = await sharp({create: {width: 80, height: 120, channels: 3, background: '#6848ee'}}).png().toBuffer();
const webp = await sharp(png).webp().toBuffer();
class Query {
  filters = []; op = 'select'; values = null;
  constructor(table) { this.rows = tables[table]; assert.ok(this.rows, `Unexpected table ${table}`); }
  select() { return this; }
  eq(key, value) { this.filters.push(row=>row[key]===value); return this; }
  is(key, value) { return this.eq(key,value); }
  not(key, _operator, value) { this.filters.push(row=>row[key]!==value); return this; }
  lt(key, value) { this.filters.push(row=>row[key]<value); return this; }
  in(key, values) { this.filters.push(row=>values.includes(row[key])); return this; }
  order() { return this; }
  limit() { return this; }
  insert(values) { this.op='insert'; this.values=values; return this; }
  update(values) { this.op='update'; this.values=values; return this; }
  delete() { this.op='delete'; return this; }
  execute(single = false) {
    let data = [...this.rows.values()].filter(row=>this.filters.every(f=>f(row)));
    if (failSave && (this.op==='insert' || this.op==='update')) return {data:null,error:{message:'Injected DB failure'}};
    if (this.op==='insert') {
      if(this.rows.has(this.values.id)) return {data:null,error:{message:'Duplicate ID'}};
      const row={created_at:new Date().toISOString(),published_at:null,...this.values}; this.rows.set(row.id,row); data=[row];
    } else if(this.op==='update') { for(const row of data) Object.assign(row,this.values); }
    else if(this.op==='delete') { for(const row of data) this.rows.delete(row.id); }
    return {data:single ? data[0] ?? null : data.map(x=>({...x})),error:null};
  }
  async maybeSingle() { return this.execute(true); }
  async single() { return this.execute(true); }
  then(resolve,reject) { return Promise.resolve(this.execute()).then(resolve,reject); }
}
supabase.from = table=>new Query(table);
supabase.storage.from = bucket=>({
  async upload(path,bytes) { objects.set(`${bucket}/${path}`, Buffer.from(bytes)); return {data:{path},error:null}; },
  async download(path) {
    const bytes=objects.get(`${bucket}/${path}`);
    // Yield so two publications both read the unpublished record before either writes.
    await new Promise(resolve=>setImmediate(resolve));
    return bytes ? {data:new Blob([bytes],{type:bucket==='gallery-staging'?'image/png':'image/webp'}),error:null} : {data:null,error:{message:'Missing object'}};
  },
  async remove(paths) { for(const path of paths) {removed.push(`${bucket}/${path}`); objects.delete(`${bucket}/${path}`);} return {error:null}; },
  async createSignedUrl(path) { return {data:{signedUrl:`https://fixture.supabase.co/${bucket}/${path}`},error:null}; },
});
beforeEach(()=> { for(const table of Object.values(tables)) table.clear(); objects.clear(); removed.length=0; failSave=false; });
after(()=> { supabase.from=originalFrom; supabase.storage.from=originalStorage; globalThis.fetch=originalFetch; });
function generation() {
  const id=randomUUID(); const path=`${owner}/${id}.webp`;
  const row={id,contributor_id:owner,source:'generated',private_storage_path:path,created_at:'2026-10-06T12:00:00Z',published_at:null,title:'Saved title',description:'Saved description'};
  tables.images.set(id,row); objects.set(`generated-images/${path}`,webp); return row;
}
function ticket(age=0) {
  const id=randomUUID(); const row={id,contributor_id:owner,storage_path:`${owner}/${id}`,created_at:new Date(Date.now()-age*3600_000).toISOString()};
  tables.gallery_uploads.set(id,row); objects.set(`gallery-staging/${row.storage_path}`,png); return row;
}

test('concurrent generation publication changes one row and cleans up only the losing copy', async()=> {
  const row=generation();
  assert.deepEqual(await Promise.all([publishGalleryImage(owner,row.id,'generated'),publishGalleryImage(owner,row.id,'generated')]), [row.id,row.id]);
  assert.equal(tables.images.size,1); assert.equal(row.title,'Saved title'); assert.equal(row.created_at,'2026-10-06T12:00:00Z');
  assert.ok(row.published_at); assert.ok(objects.has(`gallery-photos/${row.public_storage_path}`));
  assert.ok(objects.has(`generated-images/${row.private_storage_path}`));
  assert.equal([...objects.keys()].filter(x=>x.startsWith('gallery-photos/')).length,1);
  assert.equal(removed.length,1);
  assert.equal(await publishGalleryImage(owner,row.id,'generated'),row.id); assert.equal(removed.length,1);
});

test('concurrent upload publication preserves ticket creation time and retains the cleanup ticket', async()=> {
  const upload=ticket(1);
  assert.deepEqual(await Promise.all([publishGalleryImage(owner,upload.id,'upload'),publishGalleryImage(owner,upload.id,'upload')]),[upload.id,upload.id]);
  const row=tables.images.get(upload.id);
  assert.equal(row.created_at,upload.created_at); assert.equal(row.source,'upload');
  assert.ok(tables.gallery_uploads.has(upload.id)); assert.ok(!objects.has(`gallery-staging/${upload.storage_path}`));
  assert.ok(objects.has(`gallery-photos/${row.public_storage_path}`));
  assert.equal([...objects.keys()].filter(x=>x.startsWith('gallery-photos/')).length,1);
});

test('ownership, source, expiration and missing bytes prevent publication', async()=> {
  const row=generation(); const expired=ticket(3); const missing=ticket(); objects.delete(`gallery-staging/${missing.storage_path}`);
  await assert.rejects(publishGalleryImage(randomUUID(),row.id,'generated'),/does not belong/);
  await assert.rejects(publishGalleryImage(owner,row.id,'upload'),/does not belong/);
  await assert.rejects(publishGalleryImage(owner,expired.id,'upload'),/expired/);
  await assert.rejects(publishGalleryImage(owner,missing.id,'upload'),/Upload your photo/);
  assert.equal(row.published_at,null);
});

test('failed publication removes its new public copy and leaves the private generation intact', async()=> {
  const row=generation(); failSave=true;
  await assert.rejects(publishGalleryImage(owner,row.id,'generated'),/Couldn’t publish/);
  assert.equal(row.published_at,null); assert.ok(objects.has(`generated-images/${row.private_storage_path}`));
  assert.equal([...objects.keys()].filter(x=>x.startsWith('gallery-photos/')).length,0);
});

test('generated images are saved in images and failed inserts remove private objects', async()=> {
  globalThis.fetch=async ()=>new Response(new Uint8Array(png),{headers:{'Content-Type':'image/png'}});
  const saved=await saveGeneratedImage(owner,'https://fixture.volces.com/image.png');
  const row=tables.images.get(saved.generationId); assert.equal(row.source,'generated'); assert.equal(row.published_at,null);
  assert.ok(objects.has(`generated-images/${row.private_storage_path}`));
  failSave=true; await assert.rejects(saveGeneratedImage(owner,'https://fixture.volces.com/image.png'),/Couldn’t save/);
  assert.equal([...objects.keys()].filter(x=>x.startsWith('generated-images/')).length,1);
});

test('validation and expired staging cleanup preserve fresh tickets and published images', async()=> {
  await assert.rejects(normalizeGalleryImage(Buffer.from('invalid'),'image/png'),/couldn’t be read/);
  const expired=ticket(25); const fresh=ticket(1); const row=generation();
  await cleanupGalleryStaging();
  assert.ok(!tables.gallery_uploads.has(expired.id)); assert.ok(!objects.has(`gallery-staging/${expired.storage_path}`));
  assert.ok(tables.gallery_uploads.has(fresh.id)); assert.ok(objects.has(`gallery-staging/${fresh.storage_path}`));
  assert.ok(tables.images.has(row.id));
});
