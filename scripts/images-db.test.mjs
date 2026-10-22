import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const a = '10000000-0000-4000-8000-000000000001';
const b = '10000000-0000-4000-8000-000000000002';
const pending = '10000000-0000-4000-8000-000000000003';
const generated = '20000000-0000-4000-8000-000000000001';
const privateImage = '20000000-0000-4000-8000-000000000002';
const upload = '20000000-0000-4000-8000-000000000003';
const fallback = '20000000-0000-4000-8000-000000000004';
const mismatch = '20000000-0000-4000-8000-000000000005';
const sql = async (s, params = []) => (await db.query(s, params)).rows;
const migration = await readFile(new URL('../supabase/migrations/20261007000003_consolidate_images.sql', import.meta.url), 'utf8');
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function storage.foldername(text) returns text[] language sql immutable as
    $$ select string_to_array($1, '/') $$;
  create table auth.users(id uuid primary key, raw_user_meta_data jsonb, last_sign_in_at timestamptz);
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(bucket_id text, name text);
  alter table storage.objects enable row level security;
`);
for (const name of [
  '20260930000000_create_profiles_on_first_sign_in', '20260930000001_add_profile_names',
  '20260930000002_remove_profile_display_name', '20261001000000_add_profile_photos',
  '20261006000000_add_profile_state_onboarding', '20261007000000_create_profiles_after_onboarding',
  '20261007000001_avatar_gallery', '20261007000002_my_works',
]) await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'));
await db.exec(`
  insert into auth.users(id) values ('${a}'), ('${b}'), ('${pending}');
  insert into public.profiles(id, first_name, last_name, state_code, onboarding_completed_at, avatar_path)
  values ('${a}', 'First', 'Owner', 'NY', now(), '${a}/avatar.webp'),
    ('${b}', 'Second', 'Owner', 'NY', now(), null), ('${pending}', 'Pending', 'Owner', 'NY', null, null);
  insert into public.generated_images(id, contributor_id, storage_path, created_at)
  values ('${generated}', '${a}', '${a}/generated.webp', now() - interval '3 days'),
    ('${privateImage}', '${a}', '${a}/private.webp', now() - interval '1 day');
  insert into public.gallery_uploads(id, contributor_id, storage_path, created_at)
  values ('${upload}', '${a}', '${a}/ticket', now() - interval '2 days');
  insert into public.gallery_photos(id, contributor_id, storage_path, source, generation_id, published_at)
  values ('${generated}', '${a}', '${a}/public-generated.webp', 'generated', '${generated}', now() - interval '1 hour'),
    ('${upload}', '${a}', '${a}/public-upload.webp', 'upload', null, now() - interval '2 hours'),
    ('${fallback}', '${a}', '${a}/fallback.webp', 'upload', null, now() - interval '3 hours');
  insert into public.work_captions(work_id, contributor_id, title, description)
  values ('${generated}', '${a}', 'Saved title', 'Saved description');
  insert into public.photo_votes values ('${generated}', '${a}', 1), ('${generated}', '${b}', -1), ('${upload}', '${a}', 1);
`);
// A mismatched published ID must abort the transaction without partially creating images.
// Seed a distinct generation/publication pair so the FK does not mask the guard.
await db.exec(`insert into public.generated_images values ('${mismatch}', '${a}', '${a}/mismatch.webp', now());
  insert into public.gallery_photos(id, contributor_id, storage_path, source, generation_id)
  values ('30000000-0000-4000-8000-000000000001', '${a}', '${a}/mismatch-public.webp', 'generated', '${mismatch}');`);
await assert.rejects(db.exec(migration), /IDs differ/);
await db.exec('rollback');
assert.equal((await sql("select to_regclass('public.images') as name"))[0].name, null);
await db.exec(`delete from public.gallery_photos where generation_id = '${mismatch}'; delete from public.generated_images where id = '${mismatch}';`);
await db.exec(`insert into public.work_captions(work_id, contributor_id) values ('${mismatch}', '${a}');`);
await assert.rejects(db.exec(migration), /Orphaned or owner-mismatched caption/);
await db.exec('rollback');
await db.exec(`delete from public.work_captions where work_id = '${mismatch}';`);
await db.exec(migration);
await db.exec(await readFile(new URL('../supabase/migrations/20261007000006_gallery_publication_order.sql', import.meta.url), 'utf8'));
const removeView = await readFile(new URL('../supabase/migrations/20261007000007_remove_my_works_view.sql', import.meta.url), 'utf8');
await db.exec('create view public.works_dependency_test as select * from public.my_works');
await assert.rejects(db.exec(removeView), /depend/);
await db.exec('rollback; drop view public.works_dependency_test');
await db.exec(removeView);
await db.exec(await readFile(new URL('../supabase/migrations/20261020000000_owned_works_page.sql', import.meta.url), 'utf8'));
assert.equal((await sql("select to_regclass('public.my_works') as name"))[0].name, null);
after(async () => db.close());

async function as(role, id, action) {
  await db.exec(`set role ${role}`);
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [id ?? '']);
  try { return await action(); } finally { await db.exec('reset role'); }
}
const feed = async (sort = 'top', cursor = null, limit = 60) => (await sql('select public.gallery_feed($1, $2::jsonb, $3) as page', [sort, cursor && JSON.stringify(cursor), limit]))[0].page;

test('works pagination ranks the whole owner collection, includes private works, retains totals, and denies client execution', async () => {
  const owner = '40000000-0000-4000-8000-000000000001';
  try {
  await sql('insert into auth.users(id) values ($1)', [owner]);
  await sql("insert into public.profiles(id,first_name,last_name,state_code,onboarding_completed_at) values ($1,'Page','Owner','NY',now())", [owner]);
  const ids = Array.from({length:35}, (_, i) => `50000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  for (const [i,id] of ids.entries()) {
    const time = new Date(Date.UTC(2026,0,i+1)).toISOString();
    await sql(`insert into public.images(id,contributor_id,source,private_storage_path,public_storage_path,created_at,published_at)
      values ($1,$2,'generated',$3,$4,$5,$6)`, [id,owner,`${owner}/${id}.webp`,i===34?null:`${owner}/public-${id}.webp`,time,i===34?null:time]);
  }
  await sql('insert into public.photo_votes(photo_id,voter_id,value) values ($1,$2,1),($1,$3,1)', [ids[0],a,b]);
  const page = async (sort='top',cursor=null) => (await as('service_role',null,()=>sql('select public.owned_works_page($1,$2,$3::jsonb,30) as page',[owner,sort,cursor&&JSON.stringify(cursor)])))[0].page;
  const first=await page(),second=await page('top',first.next_cursor);
  assert.equal(first.items.length,30);assert.equal(first.items[0].id,ids[0]);
  assert.equal(second.items.length,5);assert.equal(second.next_cursor,null);
  assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,35);
  assert.ok([...first.items,...second.items].every(row=>ids.includes(row.id)));
  assert.deepEqual(first.received,{upvotes:'2',downvotes:'0'});assert.deepEqual(second.received,first.received);
  assert.equal((await page('newest')).items[0].id,ids[34]);
  assert.equal((await page('newest')).items[0].published_at,null);
  await assert.rejects(page('newest',first.next_cursor),/Invalid works cursor/);
  for (const role of ['anon','authenticated']) await assert.rejects(as(role,a,()=>sql('select public.owned_works_page($1)',[owner])),/permission denied/);
  } finally {
    await sql('delete from public.images where contributor_id=$1', [owner]);
    await sql('delete from public.profiles where id=$1', [owner]);
    await sql('delete from auth.users where id=$1', [owner]);
  }
});

test('backfill preserves IDs, captions, votes, creation dates, private assets and profile photos', async () => {
  const rows = await sql('select * from public.images order by id');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].title, 'Saved title'); assert.equal(rows[0].description, 'Saved description');
  assert.equal(rows[1].published_at, null); assert.equal(rows[1].public_storage_path, null);
  assert.deepEqual(rows[2].created_at, (await sql('select created_at from public.gallery_uploads'))[0].created_at);
  assert.deepEqual(rows[3].created_at, rows[3].published_at);
  assert.equal((await sql('select count(*)::int as n from public.photo_votes'))[0].n, 3);
  assert.equal((await sql('select avatar_path from public.profiles where id=$1', [a]))[0].avatar_path, `${a}/avatar.webp`);
  assert.equal((await sql('select count(*)::int as n from public.generated_images'))[0].n, 2);
});

test('downvotes do not reduce rank; publication time wins ties even when creation order differs', async () => {
  const page = await as('anon', null, () => feed());
  assert.deepEqual(page.items.slice(0, 2).map(x => x.id), [generated, upload]);
  assert.equal(page.items[0].upvotes, 1); assert.equal(page.items[1].upvotes, 1);
  assert.ok(!page.items.some(x => x.id === privateImage));
  assert.ok(page.items.every(x => !('private_storage_path' in x) && !('downvotes' in x)));
  assert.deepEqual(await sql('select upvotes::int, downvotes::int from public.gallery_vote_totals where photo_id=$1', [generated]), [{upvotes:1, downvotes:1}]);
  assert.equal((await as('anon', null, () => feed('newest'))).items[0].id, generated);
  await as('authenticated', b, () => sql('select public.set_photo_vote($1, 1::smallint)', [upload]));
  assert.equal((await as('anon', null, () => feed())).items[0].id, upload);
  await as('authenticated', b, () => sql('select public.set_photo_vote($1, null)', [upload]));
});

test('RLS and column grants isolate images and restrict captions; legacy tables are restricted', async () => {
  assert.equal((await as('authenticated', b, () => sql('select * from public.images'))).length, 0);
  assert.equal((await as('authenticated', a, () => sql('select * from public.images'))).length, 4);
  await assert.rejects(as('anon', null, () => sql('select * from public.images')), /permission denied/);
  await assert.rejects(as('authenticated', a, () => sql('select * from public.generated_images')), /permission denied/);
  await assert.rejects(as('authenticated', a, () => sql('update public.images set contributor_id=$1 where id=$2', [b, generated])), /permission denied/);
  await assert.rejects(as('authenticated', b, () => sql("select public.save_work_caption($1, 'Stolen', '')", [generated])), /Work not found/);
  await assert.rejects(as('authenticated', pending, () => sql("select public.save_work_caption($1, 'Pending', '')", [generated])), /Finish signup/);
  await as('authenticated', a, () => sql("select public.save_work_caption($1, '  Updated  ', 'Description')", [generated]));
  assert.equal((await feed()).items.find(x=>x.id===generated).title, 'Updated');
  await assert.rejects(as('authenticated', a, () => sql('select public.save_work_caption($1, $2, $3)', [generated, 'x'.repeat(101), ''])), /check constraint/);
  await assert.rejects(as('service_role', null, () => sql("update public.work_captions set title='obsolete'")), /permission denied/);
});

test('votes are idempotent, private and require published images, including direct inserts', async () => {
  await assert.rejects(as('authenticated', a, () => sql('select public.set_photo_vote($1, 1::smallint)', [privateImage])), /published image/);
  await assert.rejects(as('authenticated', a, () => sql('insert into public.photo_votes values ($1,$2,1)', [privateImage,a])), /published image/);
  await assert.rejects(as('authenticated', pending, () => sql('select public.set_photo_vote($1, 1::smallint)', [upload])), /Finish signup/);
  await as('authenticated', b, async () => {
    await sql('select public.set_photo_vote($1, -1::smallint)', [generated]);
    await sql('select public.set_photo_vote($1, -1::smallint)', [generated]);
    assert.ok((await sql('select * from public.photo_votes')).every(x=>x.voter_id===b));
    await sql('select public.set_photo_vote($1, 1::smallint)', [generated]);
  });
  assert.equal((await sql('select upvotes::int from public.gallery_vote_totals where photo_id=$1', [generated]))[0].upvotes, 2);
  assert.equal((await feed()).items[0].id, generated); // More upvotes outrank newer creations.
  await as('authenticated', b, () => sql('select public.set_photo_vote($1, null)', [generated]));
  assert.equal((await sql('select upvotes::int from public.gallery_vote_totals where photo_id=$1', [generated]))[0].upvotes, 1);
});

test('constraints reject missing paths, mismatched publication state and foreign-owner paths', async () => {
  for (const [source, privatePath, publicPath, published] of [
    ['generated', null, null, null], ['upload', null, null, null],
    ['generated', `${a}/valid.webp`, `${a}/public.webp`, null],
    ['generated', `${b}/foreign.webp`, null, null],
  ]) await assert.rejects(sql('insert into public.images(contributor_id,source,private_storage_path,public_storage_path,published_at) values ($1,$2,$3,$4,$5)', [a,source,privatePath,publicPath,published]), /check constraint/);
});

test('weekly publication boundaries and publication/ID cursors work without duplicates', async () => {
  const [{start}] = await sql("select date_trunc('week', now() at time zone 'America/New_York') at time zone 'America/New_York' as start");
  await sql(`insert into public.images(id,contributor_id,source,public_storage_path,created_at,published_at)
    values ('40000000-0000-4000-8000-000000000001', $1::uuid, 'upload', $1::text || '/before.webp', now()-interval '5 days', $2::timestamptz-interval '1 microsecond'),
    ('40000000-0000-4000-8000-000000000002', $1::uuid, 'upload', $1::text || '/boundary.webp', now()-interval '5 days', $2)`, [a,start]);
  const week = await feed('week');
  assert.ok(week.items.some(x=>x.id==='40000000-0000-4000-8000-000000000002'));
  assert.ok(!week.items.some(x=>x.id==='40000000-0000-4000-8000-000000000001'));
  const [dst] = await sql("select (date_trunc('week', timestamptz '2026-03-09 03:59:59+00' at time zone 'America/New_York') at time zone 'America/New_York') as before, (date_trunc('week', timestamptz '2026-03-09T04:00:00+00' at time zone 'America/New_York') at time zone 'America/New_York') as after");
  assert.ok(dst.before.toISOString().startsWith('2026-03-02T05:00')); assert.ok(dst.after.toISOString().startsWith('2026-03-09T04:00'));
  await sql(`insert into public.images(contributor_id,source,public_storage_path,created_at,published_at)
    select $1::uuid, 'upload', $1::text || '/batch-' || n || '.webp', now()-interval '10 minutes', now()-interval '1 minute' from generate_series(1,35) n`, [a]);
  for (const sort of ['top','week','newest']) {
    const all = (await feed(sort)).items;
    const batch = all.filter(x=>x.storage_path.includes('/batch-')).map(x=>x.id);
    assert.deepEqual(batch, [...batch].sort().reverse());
    assert.ok(all.every(x=>/\.\d{6}Z$/.test(x.published_at)));
    const expected = all.map(x=>x.id); const seen=[]; let cursor=null;
    do { const page=await feed(sort,cursor,7); seen.push(...page.items.map(x=>x.id)); cursor=page.next_cursor;
      if(cursor) assert.ok(cursor.published_at && !cursor.created_at);
    } while(cursor);
    assert.deepEqual(seen,expected); assert.equal(new Set(seen).size,seen.length);
  }
  await assert.rejects(feed('top',{sort:'top',id:upload,created_at:start,score:1,as_of:start}), /Invalid gallery cursor/);
});


test('retirement refuses missing generation data, then removes only redundant tables', async () => {
  const retirement = await readFile(new URL('../supabase/migrations/20261007000004_remove_legacy_image_tables.sql', import.meta.url), 'utf8');
  await sql("update public.images set private_storage_path=$1 where id=$2", [`${a}/changed.webp`, generated]);
  await assert.rejects(db.exec(retirement), /refusing deletion/);
  await db.exec('rollback');
  assert.equal((await sql("select to_regclass('public.generated_images') as name"))[0].name, 'generated_images');
  await sql("update public.images set private_storage_path=$1 where id=$2", [`${a}/generated.webp`, generated]);
  const imagesBefore=await sql('select * from public.images order by id');
  const votesBefore=await sql('select * from public.photo_votes order by photo_id, voter_id');
  await db.exec(retirement);
  for (const table of ['generated_images','gallery_photos','work_captions']) {
    assert.equal((await sql('select to_regclass($1) as name', [`public.${table}`]))[0].name, null);
  }
  assert.deepEqual(await sql('select * from public.images order by id'), imagesBefore);
  assert.deepEqual(await sql('select * from public.photo_votes order by photo_id, voter_id'), votesBefore);
  assert.ok((await feed()).items.length > 0);
  assert.ok((await as('authenticated', a, () => sql('select * from public.images'))).length > 0);
  assert.equal((await sql('select count(*)::int as n from public.gallery_uploads'))[0].n, 1);
});

test('deleting an owned meme removes its image row and cascades gallery and quest votes', async () => {
  const id = '50000000-0000-4000-8000-000000000099';
  await sql("insert into public.images(id,contributor_id,source,public_storage_path,published_at) values ($1,$2,'upload',$3,now())", [id,a,`${a}/delete-fixture.webp`]);
  await sql('insert into public.photo_votes(photo_id,voter_id,value) values ($1,$2,1)', [id,b]);
  assert.equal((await sql('select upvotes::int as n from public.gallery_vote_totals where photo_id=$1',[id]))[0].n,1);
  assert.equal((await sql('delete from public.images where id=$1 and contributor_id=$2 returning id',[id,b])).length,0);
  assert.equal((await sql('delete from public.images where id=$1 and contributor_id=$2 returning id',[id,a])).length,1);
  assert.equal((await sql('select * from public.images where id=$1',[id])).length,0);
  assert.equal((await sql('select * from public.photo_votes where photo_id=$1',[id])).length,0);
});
