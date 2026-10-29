import { auditRpcFixture } from "./generation-audit-fixture.mjs";
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fixture';
process.env.ARK_API_KEY = 'fixture';
const { supabase } = await import('../lib/supabase.ts');
const { AdminError } = await import('../lib/admin/auth.ts');
const { requireAdminPage } = await import('../lib/admin/page.ts');
const server = await import('../lib/admin/server.ts');
const usersRoute = await import('../app/api/admin/users/route.ts');
const votesRoute = await import('../app/api/admin/votes/route.ts');
const mediaRoute = await import('../app/api/admin/media/route.ts');
const generateRoute = await import('../app/api/admin/media/generate/route.ts');
const itemRoute = await import('../app/api/admin/media/[id]/route.ts');
const publishRoute = await import('../app/api/admin/media/[id]/publish/route.ts');
const previewRoute = await import('../app/api/admin/media/[id]/preview/route.ts');
const originalRoute = await import('../app/api/admin/media/[id]/original/route.ts');
const {loadRecaptionSource,recaptionTarget,replaceMediaCaption} = await import('../lib/admin/recaption.ts');
const { adminReturnPath } = await import('../lib/auth/return-path.ts');

const adminId = randomUUID(), ownerId = randomUUID(), id = randomUUID();
const saved = { from: supabase.from, rpc: supabase.rpc, storage: supabase.storage.from, fetch: globalThis.fetch, log: console.error };
let user, flag, permissionError, calls, objects, rows, removed, failInsert, failStorage, salesConflict;
let failDownload, ownerComplete, providerCalls;
const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#aaa' } }).png().toBuffer();
globalThis.__adminAuthClient = {
  auth: { async getUser() { return { data: { user }, error: null }; } },
  from(table) {
    assert.equal(table, 'profiles');
    return { select(columns) { assert.equal(columns, 'is_superadmin'); return this; }, eq(column, value) { assert.equal(column, 'id'); assert.equal(value, user.id); return this; }, async maybeSingle() { return { data: flag === null ? null : { is_superadmin: flag }, error: permissionError }; } };
  },
};
class Query {
  filters = []; op = 'select'; values;
  constructor(table) { this.table = table; calls.push(table); }
  select() { return this; } eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  is(key, value) { return this.eq(key, value); } not(key, _op, value) { this.filters.push(row => row[key] !== value); return this; }
  insert(values) { this.op = 'insert'; this.values = values; return this; }
  update(values) { this.op = 'update'; this.values = values; return this; }
  delete() { this.op = 'delete'; return this; }
  run(single = false) {
    if (this.table === 'profiles') return { data: { id: ownerId, onboarding_completed_at: ownerComplete ? '2026-01-01' : null }, error: null };
    let found = [...rows.values()].filter(row => this.filters.every(fn => fn(row)));
    if (this.op === 'insert') {
      if (failInsert) return { data: null, error: { code: 'failure' } };
      const row = { published_at: null, public_storage_path: null, ...this.values }; rows.set(row.id, row); found = [row];
    }
    if (this.op === 'update') for (const row of found) Object.assign(row, this.values);
    if (this.op === 'delete') {
      if (salesConflict) return { data: null, error: { code: '23503' } };
      for (const row of found) rows.delete(row.id);
    }
    return { data: structuredClone(single ? found[0] ?? null : found), error: null };
  }
  maybeSingle() { return Promise.resolve(this.run(true)); } single() { return this.maybeSingle(); }
  then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
}
beforeEach(() => {
  user = { id: adminId, email: 'admin@example.com', email_confirmed_at: '2026-01-01', identities: [{ provider: 'google' }], user_metadata: {} };
  flag = true; permissionError = null; calls = []; objects = new Map(); removed = []; rows = new Map();
  failInsert = false; failStorage = false; salesConflict = false; failDownload = false; ownerComplete = true; providerCalls = 0;
  globalThis.__adminInvalidations = [];
  supabase.from = table => new Query(table);
  supabase.rpc = (name, args) => { const audit = auditRpcFixture(name,args); if (audit) return audit; calls.push({ name, args }); return { data: { items: [], total: '0' }, error: null }; };
  supabase.storage.from = bucket => ({
    async upload(path, bytes) { calls.push('storage upload'); objects.set(`${bucket}/${path}`, Buffer.from(bytes)); return { error: null }; },
    async remove(paths) { if (failStorage) return { error: {} }; for (const path of paths) { removed.push(`${bucket}/${path}`); objects.delete(`${bucket}/${path}`); } return { error: null }; },
    async download(path) { if (failDownload || !objects.has(`${bucket}/${path}`)) return { error: {} }; return { data: new Blob([objects.get(`${bucket}/${path}`)], { type: 'image/webp' }), error: null }; },
  });
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/images/generations')) { providerCalls++; assert.equal(JSON.parse(options.body).prompt, 'A funny robot'); return Response.json({ data: [{ url: 'https://fixture.volces.com/image' }] }); }
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  };
});
after(() => { supabase.from = saved.from; supabase.rpc = saved.rpc; supabase.storage.from = saved.storage; globalThis.fetch = saved.fetch; console.error = saved.log; });
const context = () => ({ params: Promise.resolve({ id }) });
const request = (path, method = 'GET', body, origin = 'https://app.test') => new Request(`https://app.test${path}`, {
  method, headers: { origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const seed = () => { const row = { id, contributor_id: ownerId, source: 'generated', private_storage_path: `${ownerId}/${id}.webp`, public_storage_path: null, published_at: null, original_storage_path: null, title: 'Before', description: 'Original' }; rows.set(id, row); objects.set(`generated-images/${row.private_storage_path}`, png); return row; };

test('all entry points deny anonymous, non-admin, missing-profile, non-Google, revoked, and failed permission lookups before privileged work', async () => {
  const endpoints = [
    () => usersRoute.GET(request('/api/admin/users')), () => votesRoute.GET(request('/api/admin/votes')),
    () => mediaRoute.GET(request('/api/admin/media')), () => mediaRoute.POST(request('/api/admin/media', 'POST', {})),
    () => generateRoute.POST(request('/api/admin/media/generate', 'POST', {})),
    () => itemRoute.PATCH(request(`/api/admin/media/${id}`, 'PATCH', {}), context()),
    () => itemRoute.DELETE(request(`/api/admin/media/${id}`, 'DELETE', { confirmed: true }), context()),
    () => publishRoute.POST(request(`/api/admin/media/${id}/publish`, 'POST'), context()),
    () => previewRoute.GET(request(`/api/admin/media/${id}/preview`), context()),
    () => originalRoute.GET(request(`/api/admin/media/${id}/original`), context()),
  ];
  const google = structuredClone(user);
  for (const state of [
    { user: null, flag: true, status: 401 }, { user: google, flag: false, status: 403 },
    { user: google, flag: null, status: 403 }, { user: { ...google, identities: [{ provider: 'email' }] }, flag: true, status: 403 },
    { user: { ...google, email_confirmed_at: null }, flag: true, status: 403 },
    { user: { ...google, user_metadata: { is_superadmin: true } }, flag: false, status: 403 },
    { user: google, flag: true, permissionError: {}, status: 503 },
  ]) {
    user = state.user; flag = state.flag; permissionError = state.permissionError ?? null;
    for (const endpoint of endpoints) { const response = await endpoint(); assert.equal(response.status, state.status); assert.equal(response.headers.get('cache-control'), 'private, no-store'); }
    assert.equal(calls.length, 0);
  }
  user = google; flag = true; permissionError = null;
  assert.equal((await usersRoute.GET(request('/api/admin/users'))).status, 200);
  flag = false; calls.length = 0;
  assert.equal((await usersRoute.GET(request('/api/admin/users'))).status, 403); assert.equal(calls.length, 0);
});
test('every underlying data operation independently enforces permission', async () => {
  flag = false;
  for (const action of [() => server.listAdminUsers(new URLSearchParams()), () => server.listAdminMedia(new URLSearchParams()), () => server.listAdminVotes(new URLSearchParams()), () => server.previewAdminMedia(id), () => server.updateAdminMedia(id, {}), () => server.deleteAdminMedia(id, {}), () => server.publishAdminMedia(id), () => server.generateAdminMedia({}), () => server.uploadAdminMedia(new FormData())]) await assert.rejects(action(), error => error instanceof AdminError && error.status === 403);
  assert.equal(calls.length, 0);
});
test('page guards redirect anonymous and unauthorized users and fail closed on database errors', async () => {
  const google = user;
  user = null;
  await assert.rejects(requireAdminPage('/admin/media?status=private'), /REDIRECT:\/login\?next=%2Fadmin%2Fmedia%3Fstatus%3Dprivate/);
  user = google; flag = false;
  await assert.rejects(requireAdminPage('/admin/users'), /REDIRECT:\/auth\/access-denied\?next=%2Fadmin%2Fusers/);
  flag = true; permissionError = {};
  await assert.rejects(requireAdminPage('/admin/users'), error => error.status === 503);
  permissionError = null;
  assert.equal((await requireAdminPage('/admin/users')).id, adminId);
});
test('mutating endpoints reject missing and foreign origins before reads, writes or provider calls', async () => {
  for (const origin of ['', 'https://evil.test']) for (const endpoint of [
    () => mediaRoute.POST(request('/api/admin/media', 'POST', {}, origin)),
    () => generateRoute.POST(request('/api/admin/media/generate', 'POST', {}, origin)),
    () => itemRoute.PATCH(request(`/api/admin/media/${id}`, 'PATCH', {}, origin), context()),
    () => itemRoute.DELETE(request(`/api/admin/media/${id}`, 'DELETE', {}, origin), context()),
    () => publishRoute.POST(request(`/api/admin/media/${id}/publish`, 'POST', undefined, origin), context()),
  ]) assert.equal((await endpoint()).status, 403);
  assert.equal(calls.length, 0); assert.equal(providerCalls, 0);
});
test('reads validate filters, cap pagination and return explicit DTO pages', async () => {
  assert.equal((await usersRoute.GET(request('/api/admin/users?search=owner&page=2&limit=30'))).status, 200);
  assert.deepEqual(calls[0], { name: 'admin_users_page', args: { p_offset: 30, p_limit: 30, p_search: 'owner', p_completed: false } });
  for (const params of ['limit=101', 'page=0', 'page=1.5', 'page=10001', 'search=' + 'a'.repeat(201)]) assert.equal((await usersRoute.GET(request('/api/admin/users?' + params))).status, 400);
  assert.equal((await mediaRoute.GET(request('/api/admin/media?source=bad'))).status, 400);
  assert.equal((await mediaRoute.GET(request('/api/admin/media?owner=not-a-uuid'))).status, 400);
  assert.equal((await votesRoute.GET(request('/api/admin/votes?kind=battle&value=1'))).status, 400);
  assert.equal((await votesRoute.GET(request('/api/admin/votes?kind=battle'))).status, 200);
});
test('caption editing ignores protected fields and preserves file, owner and publication', async () => {
  const row = seed();
  const response = await itemRoute.PATCH(request(`/api/admin/media/${id}`, 'PATCH', { title: ' Edited ', description: ' Caption ', contributor_id: adminId, is_superadmin: true, published_at: '2026-01-01' }), context());
  assert.equal(response.status, 200); assert.equal(row.title, 'Edited'); assert.equal(row.description, 'Caption'); assert.equal(row.contributor_id, ownerId); assert.equal(row.published_at, null); assert.equal(objects.size, 1);
  assert.ok(globalThis.__adminInvalidations.includes('/gallery'));
  assert.equal((await itemRoute.PATCH(request(`/api/admin/media/${id}`, 'PATCH', { title: 'a'.repeat(101), description: '' }), context())).status, 400);
  assert.equal((await itemRoute.PATCH(request(`/api/admin/media/${id}`, 'PATCH', { title: '', description: 'a'.repeat(1001) }), context())).status, 400);
  assert.equal((await itemRoute.PATCH(request(`/api/admin/media/${id}`, 'PATCH', { title: 'a'.repeat(33_000), description: '' }), context())).status, 400);
});
test('previews stream bytes without a signed URL and disappear on revocation', async () => {
  seed(); const response = await previewRoute.GET(request(`/api/admin/media/${id}/preview`), context());
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  flag = false; assert.equal((await previewRoute.GET(request(`/api/admin/media/${id}/preview`), context())).status, 403);
});
test('deletion requires confirmation, honors sale conflicts, removes bytes after row deletion and tolerates retries', async () => {
  seed(); assert.equal((await itemRoute.DELETE(request(`/api/admin/media/${id}`, 'DELETE', {}), context())).status, 400); assert.equal(rows.size, 1);
  salesConflict = true; assert.equal((await itemRoute.DELETE(request(`/api/admin/media/${id}`, 'DELETE', { confirmed: true }), context())).status, 409); assert.equal(rows.size, 1); assert.equal(removed.length, 0);
  salesConflict = false; const result = await itemRoute.DELETE(request(`/api/admin/media/${id}`, 'DELETE', { confirmed: true }), context());
  assert.equal(result.status, 200); assert.equal(rows.size, 0); assert.equal(objects.size, 0);
  assert.equal((await itemRoute.DELETE(request(`/api/admin/media/${id}`, 'DELETE', { confirmed: true }), context())).status, 200);
});
test('Storage cleanup failures log the retry target without resurrecting deleted records', async () => {
  seed(); failStorage = true; const logs = []; console.error = (...args) => logs.push(args);
  try { assert.deepEqual(await server.deleteAdminMedia(id, { confirmed: true }), { deleted: true }); assert.equal(rows.size, 0); assert.equal(logs[0][1].bucket, 'generated-images'); }
  finally { console.error = saved.log; }
});
function uploadForm(bytes = png, mime = 'image/png') { const form = new FormData(); form.set('title', 'Uploaded'); form.set('description', 'Finished AI media'); form.set('file', new File([bytes], 'image.png', { type: mime })); return form; }
test('uploads validate image bytes, create private media, and clean failed inserts', async () => {
  const result = await server.uploadAdminMedia(uploadForm()); assert.ok(result.id); assert.equal(rows.get(result.id).published_at, null); assert.equal(rows.get(result.id).contributor_id, adminId); assert.equal(objects.size, 1);
  await assert.rejects(server.uploadAdminMedia(uploadForm(Buffer.from('not an image'))));
  await assert.rejects(server.uploadAdminMedia(uploadForm(png, 'image/svg+xml')));
  await assert.rejects(server.uploadAdminMedia(uploadForm(Buffer.alloc(2 * 1024 * 1024 + 1))));
  failInsert = true; await assert.rejects(server.uploadAdminMedia(uploadForm())); assert.equal(objects.size, 1);
});
test('multipart upload endpoints validate and bound the request before saving a private record', async () => {
  const response = await mediaRoute.POST(new Request('https://app.test/api/admin/media', { method: 'POST', headers: { origin: 'https://app.test' }, body: uploadForm() }));
  assert.equal(response.status, 201); assert.equal(rows.size, 1); assert.equal(objects.size, 1);
  const oversized = await mediaRoute.POST(new Request('https://app.test/api/admin/media', { method: 'POST', headers: { origin: 'https://app.test', 'Content-Type': 'multipart/form-data; boundary=fixture' }, body: new Uint8Array(2 * 1024 * 1024 + 65_537) }));
  assert.equal(oversized.status, 413); assert.equal(rows.size, 1); assert.equal(objects.size, 1);
});
test('generation uses existing provider, validates owners, and saves no partial record on failure or revocation', async () => {
  const body = { prompt: 'A funny robot', title: 'Robot', description: '', owner: ownerId };
  const result = await server.generateAdminMedia(body); assert.equal(providerCalls, 1); assert.equal(rows.get(result.id).contributor_id, ownerId);
  rows.clear(); objects.clear(); ownerComplete = false;
  await assert.rejects(server.generateAdminMedia(body)); assert.equal(providerCalls, 1);
  ownerComplete = true; globalThis.fetch = async () => new Response('', { status: 502 });
  await assert.rejects(server.generateAdminMedia(body)); assert.equal(rows.size, 0); assert.equal(objects.size, 0);
  globalThis.fetch = async url => { if (String(url).includes('/images/generations')) return Response.json({ data: [{ url: 'https://fixture.volces.com/image' }] }); flag = false; return new Response(png, { headers: { 'Content-Type': 'image/png' } }); };
  await assert.rejects(server.generateAdminMedia(body), error => error.status === 403); assert.equal(rows.size, 0); assert.equal(objects.size, 0);
});
test('publication reuses owner-scoped publication and remains idempotent', async () => {
  seed(); const result = await publishRoute.POST(request(`/api/admin/media/${id}/publish`, 'POST'), context());
  assert.equal(result.status, 200); assert.ok(rows.get(id).published_at); assert.equal(objects.size, 2);
  assert.equal((await publishRoute.POST(request(`/api/admin/media/${id}/publish`, 'POST'), context())).status, 200); assert.equal(objects.size, 2);
});
test('only safe admin destinations survive login; ordinary login keeps the welcome flow', () => {
  assert.equal(adminReturnPath('/admin/media?page=2'), '/admin/media?page=2');
  for (const value of ['//evil.test/admin', 'https://evil.test/admin', '/admin\\evil', '/admin\r\n', '/administrator', '/gallery', null]) assert.equal(adminReturnPath(value), null);
});

test('original photo reads are protected and missing legacy originals never fall back to captioned images', async () => {
  seed();
  const missing = await originalRoute.GET(request(`/api/admin/media/${id}/original`), context());
  assert.equal(missing.status,200);assert.equal((await missing.json()).image,null);
  objects.set(`generated-images/${ownerId}/originals/${id}`,png);
  const response=await originalRoute.GET(request(`/api/admin/media/${id}/original`),context());
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal((await response.json()).image,`data:image/png;base64,${png.toString('base64')}`);
  flag=false;await assert.rejects(loadRecaptionSource(id),error=>error.status===403);
  await assert.rejects(recaptionTarget(id),error=>error.status===403);
});

test('changing a caption switches the rendered image and text together while retaining identity, owner, votes and publication status', async () => {
  for(const source of ['generated','upload']) {
    const row=seed();row.source=source;row.upvotes='9';row.downvotes='2';row.published_at='2026-10-20T12:00:00Z';
    row.public_storage_path=`${ownerId}/old-public.webp`;
    if(source==='upload')row.private_storage_path=null;
    const target=await recaptionTarget(id),batchId=randomUUID(),path=`${adminId}/factory/${batchId}/0.webp`;
    objects.set(`generated-images/${path}`,png);
    objects.set(`generated-images/${adminId}/factory/${batchId}/original`,png);
    const batch={id:batchId,user_id:adminId,variants:[{caption:'New caption',path,replaces:target,originalSaved:true}]};
    assert.equal(await replaceMediaCaption(batch,0),id);
    assert.equal(rows.size,1);assert.equal(row.id,id);assert.equal(row.contributor_id,ownerId);
    assert.equal(row.source,source);assert.equal(row.upvotes,'9');assert.equal(row.downvotes,'2');
    assert.equal(row.published_at,'2026-10-20T12:00:00Z');assert.equal(row.description,'New caption');
    assert.deepEqual(objects.get(`gallery-photos/${row.public_storage_path}`),png);
    assert.equal(row.private_storage_path,source==='generated'?`${ownerId}/recaption/${batchId}.webp`:null);
    assert.deepEqual(objects.get(`generated-images/${ownerId}/originals/${id}`),png);
    assert.equal((await loadRecaptionSource(id)).image,`data:image/png;base64,${png.toString('base64')}`);
    assert.equal(await replaceMediaCaption(batch,0),id,'a retry keeps the same media record');
  }
});

test('private caption changes stay private, and stale editors or revoked admins cannot replace media', async () => {
  const row=seed(),target=await recaptionTarget(id),batchId=randomUUID(),path=`${adminId}/factory/${batchId}/0.webp`;
  objects.set(`generated-images/${path}`,png);
  const batch={id:batchId,user_id:adminId,variants:[{caption:'New caption',path,replaces:target}]};
  flag=false;await assert.rejects(replaceMediaCaption(batch,0),error=>error.status===403);
  flag=true;await replaceMediaCaption(batch,0);
  assert.equal(row.published_at,null);assert.equal(row.public_storage_path,null);
  const stale={...batch,id:randomUUID()};
  await assert.rejects(replaceMediaCaption(stale,0),error=>error.status===409);
  assert.equal(row.description,'New caption');
});

test('the shared original_storage_path takes precedence and its file and link stay unchanged across caption saves',async()=>{
 const row=seed(),batchId=randomUUID();
 const original=await sharp({create:{width:40,height:40,channels:3,background:'#22aa33'}}).png().toBuffer();
 row.original_storage_path=`${ownerId}/factory/${id}/original.png`;
 objects.set(`generated-images/${row.original_storage_path}`,original);
 // A former filename lookup must not override the authoritative shared link.
 objects.set(`generated-images/${ownerId}/originals/${id}`,png);
 const response=await originalRoute.GET(request(`/api/admin/media/${id}/original`),context());
 assert.equal((await response.json()).image,`data:image/png;base64,${original.toString('base64')}`);
 const target=await recaptionTarget(id),path=`${adminId}/factory/${batchId}/0.webp`;
 objects.set(`generated-images/${path}`,png);
 objects.set(`generated-images/${adminId}/factory/${batchId}/original`,png);
 const beforePath=row.original_storage_path,beforeFile=objects.get(`generated-images/${beforePath}`);
 const batch={id:batchId,user_id:adminId,variants:[{caption:'Changed caption',path,replaces:target,originalSaved:true}]};
 await replaceMediaCaption(batch,0);await replaceMediaCaption(batch,0);
 assert.equal(row.original_storage_path,beforePath);
 assert.equal(objects.get(`generated-images/${beforePath}`),beforeFile,'the existing original must not be rewritten');
 assert.deepEqual(beforeFile,original);assert.equal(row.description,'Changed caption');
 assert.equal((await loadRecaptionSource(id)).image,`data:image/png;base64,${original.toString('base64')}`);
});

test('broken, foreign and changed original links fail without loading a captioned fallback or saving an edit',async()=>{
 const row=seed();row.original_storage_path=`${ownerId}/factory/${id}/original.png`;
 await assert.rejects(loadRecaptionSource(id),error=>error.status===503);
 row.original_storage_path=`${adminId}/factory/${id}/original.png`;
 await assert.rejects(loadRecaptionSource(id),error=>error.status===503);
 row.original_storage_path=row.private_storage_path;
 await assert.rejects(loadRecaptionSource(id),error=>error.status===503);
 row.original_storage_path=`${ownerId}/first-original.png`;
 const target=await recaptionTarget(id);
 row.original_storage_path=`${ownerId}/another-original.png`;
 const batch={id:randomUUID(),user_id:adminId,variants:[{caption:'Changed',path:'unused',replaces:target}]};
 await assert.rejects(replaceMediaCaption(batch,0),error=>error.status===409);
 assert.equal(row.description,'Original');
});

test('generated media stays scoped to generated images while the images page reads every source',async()=>{
 const {default:MediaPage}=await import('../app/admin/media/page.tsx');
 const {default:ImagesPage}=await import('../app/admin/images/page.tsx');
 for(const source of ['', 'upload', 'generated']){
  calls=[];
  const page=await MediaPage({searchParams:Promise.resolve({source})});
  assert.equal(page.props.section,'media');
  assert.equal(calls.find(call=>call.name==='admin_media_page').args.p_source,'generated');
 }
 calls=[];
 const page=await ImagesPage({searchParams:Promise.resolve({})});
 assert.equal(page.props.section,'images');
 assert.equal(calls.find(call=>call.name==='admin_media_page').args.p_source,null);
});
