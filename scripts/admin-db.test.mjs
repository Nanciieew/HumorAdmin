import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { grantSql } from './admin-setup.mjs';
const db = new PGlite();
const sql = async (text, params = []) => (await db.query(text, params)).rows;
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  grant usage on schema public,auth,storage to anon,authenticated,service_role;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now(),raw_user_meta_data jsonb,last_sign_in_at timestamptz);
  create table auth.identities(user_id uuid references auth.users(id) on delete cascade,provider text);
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(bucket_id text,name text);
  alter table storage.objects enable row level security;
`);
for (const name of [
  '20260930000000_create_profiles_on_first_sign_in','20260930000001_add_profile_names',
  '20260930000002_remove_profile_display_name','20261001000000_add_profile_photos',
  '20261006000000_add_profile_state_onboarding','20261007000000_create_profiles_after_onboarding',
  '20261007000001_avatar_gallery','20261007000002_my_works','20261007000003_consolidate_images',
  '20261007000004_remove_legacy_image_tables','20261007000005_remove_avatar',
  '20261007000006_gallery_publication_order','20261007000007_remove_my_works_view',
  '20261008000000_sales_leaderboard','20261008000001_personal_dashboard','20261014000000_ego_check',
  '20261019000000_factory_batches','20261020000000_owned_works_page',
]) await db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'));
const [a,b,pending] = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'];
for (const [i,id] of [a,b,pending].entries()) await sql("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[id,['owner@example.com','ordinary@example.com','pending@example.com'][i]]);
await sql("insert into profiles(id,first_name,last_name,state_code,onboarding_completed_at) values($1,'Original','Owner','NY',now()),($2,'Ordinary','User','CA',now())",[a,b]);
await sql("insert into auth.identities values($1,'google'),($2,'google')",[a,b]);
await db.exec(await readFile(new URL('../supabase/migrations/20261020000001_admin_area.sql',import.meta.url),'utf8'));
after(()=>db.close());
async function as(role,id,action) { await db.exec(`set role ${role}`); await sql("select set_config('request.jwt.claim.sub',$1,false)",[id??'']); try{return await action();}finally{await db.exec('reset role');} }
const rpc = async(text,params=[]) => (await as('service_role',null,()=>sql(`select ${text} as page`,params)))[0].page;

test('migration preserves existing users and defaults all profiles to non-admin', async()=>{
  const rows=await sql('select id,is_superadmin from profiles order by id');
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.is_superadmin===false));
});
test('only the trusted operator can bootstrap an exact, confirmed Google account with a profile', async()=>{
  for(const email of ['missing@example.com','pending@example.com']){
    await assert.rejects(db.exec(grantSql(email)));await db.exec('rollback');
  }
  await sql('update auth.users set email_confirmed_at=null where id=$1',[b]);
  await assert.rejects(db.exec(grantSql('ordinary@example.com')));await db.exec('rollback');
  await sql('update auth.users set email_confirmed_at=now() where id=$1',[b]);
  await sql("delete from auth.identities where user_id=$1",[b]);
  await assert.rejects(db.exec(grantSql('ordinary@example.com')));await db.exec('rollback');
  await sql("insert into auth.identities values($1,'google')",[b]);
  assert.throws(()=>grantSql("owner@example.com';update profiles set is_superadmin=true;--"));
  await db.exec(grantSql('OWNER@example.com'));
  assert.equal((await sql('select is_superadmin from profiles where id=$1',[a]))[0].is_superadmin,true);
  assert.equal((await sql('select is_superadmin from profiles where id=$1',[b]))[0].is_superadmin,false);
  await db.exec(grantSql('owner@example.com')); // A retry changes no other account.
});
test('ordinary users cannot promote themselves or call the service-only read functions', async()=>{
  for(const role of ['anon','authenticated']) await as(role,b,async()=>{
    await assert.rejects(sql('update profiles set is_superadmin=true where id=$1',[b]),/permission denied/);
    await assert.rejects(sql('insert into profiles(id,is_superadmin) values($1,true)',[pending]),/permission denied/);
    await assert.rejects(sql('select admin_users_page()'),/permission denied/);
    await assert.rejects(sql('select admin_media_page()'),/permission denied/);
    await assert.rejects(sql('select admin_votes_page()'),/permission denied/);
  });
  const own=await as('authenticated',b,()=>sql('select id,is_superadmin from profiles'));
  assert.deepEqual(own,[{id:b,is_superadmin:false}]);
});
test('user reads include pending accounts, expose only the DTO, and support exact pagination and literal searches', async()=>{
  const page=await rpc('admin_users_page($1,0,1,false)',['']);assert.equal(page.items.length,1);assert.equal(page.total,'3');
  const pendingPage=await rpc('admin_users_page($1,0,25,false)',['pending@example.com']);
  assert.equal(pendingPage.items[0].profile_created_at,null);assert.equal(pendingPage.items[0].is_superadmin,false);
  assert.ok(!('raw_user_meta_data' in pendingPage.items[0]));
  const completed=await rpc("admin_users_page('',0,25,true)");assert.equal(completed.total,'2');
  assert.equal((await rpc('admin_users_page($1,0,25,false)',['%'])).total,'0');
  const second=await rpc("admin_users_page('',1,1,false)");assert.notEqual(second.items[0].id,page.items[0].id);
});
const mediaIds=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'];
test('media listing includes private images and exact vote totals; gallery and battle reads preserve existing votes', async()=>{
  for(const [i,id]of mediaIds.entries()) await sql("insert into images(id,contributor_id,source,private_storage_path,public_storage_path,published_at,title) values($1,$2,'generated',$3,$4,$5,$6)",[id,a,`${a}/${id}.webp`,i===0?`${a}/public.webp`:null,i===0?new Date().toISOString():null,i===0?'Published meme':'Private meme']);
  await sql('insert into photo_votes values($1,$2,1),($1,$3,-1)',[mediaIds[0],a,b]);
  const page=await rpc('admin_media_page()');assert.equal(page.total,'2');assert.equal(page.items.find(x=>x.id===mediaIds[0]).upvotes,'1');assert.equal(page.items.find(x=>x.id===mediaIds[0]).downvotes,'1');
  assert.ok(page.items.every(x=>!('private_storage_path'in x)));
  assert.equal((await rpc("admin_media_page('',null,null,'private',0,25)")).total,'1');
  const votes=await rpc("admin_votes_page('gallery')");assert.equal(votes.total,'2');assert.ok(votes.items.some(x=>x.value===-1));
  assert.equal((await rpc("admin_votes_page('gallery',$1,null,1::smallint)",[mediaIds[0]])).total,'1');
  const challenge=(await sql("insert into ego_challenges(creator,opponent,visibility,status) values($1,$2,'public','voting') returning id",[a,b]))[0].id;
  await sql('insert into ego_votes(challenge_id,voter_id,target_id) values($1,$2,$3)',[challenge,b,a]);
  const battle=await rpc("admin_votes_page('battle')");assert.equal(battle.total,'1');assert.equal(battle.items[0].target_id,a);
});
test('whole-record deletion cascades gallery votes, while sales retain their immutable referenced media',async()=>{
  await sql("insert into image_sales(image_id,seller_id,seller_state_code,amount_cents,sold_at,reference) values($1,$2,'NY',100,now(),'admin-test-sale')",[mediaIds[0],a]);
  await assert.rejects(sql('delete from images where id=$1',[mediaIds[0]]),/foreign key/);
  assert.equal((await sql('select count(*)::int as n from photo_votes'))[0].n,2);
  // A separate unsold published image exercises the actual cascade.
  const id='20000000-0000-4000-8000-000000000003';
  await sql("insert into images(id,contributor_id,source,private_storage_path,public_storage_path,published_at) values($1,$2,'generated',$3,$4,now())",[id,a,`${a}/delete.webp`,`${a}/delete-public.webp`]);
  await sql('insert into photo_votes values($1,$2,1)',[id,b]);await sql('delete from images where id=$1',[id]);
  assert.equal((await sql('select count(*)::int as n from photo_votes where photo_id=$1',[id]))[0].n,0);
});
