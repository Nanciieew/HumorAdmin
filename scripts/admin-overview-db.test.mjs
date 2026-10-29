import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
await db.exec(`create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),created_at timestamptz not null);
  create table public.images(id uuid primary key default gen_random_uuid(),source text not null,published_at timestamptz);
  create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;`);
const migration = await readFile(new URL('../supabase/migrations/20261029000002_admin_overview.sql',import.meta.url),'utf8');
await db.exec(migration);await db.exec(migration);
after(()=>db.close());
const overview = async timestamp => (await db.query('select admin_overview($1::timestamptz) as data',[timestamp])).rows[0].data;
test('an empty database returns exact zero counts and the New York month including DST',async()=>{
  const result=await overview('2026-11-15T12:00:00Z');
  for(const key of ['total_users','new_users_this_month','total_memes','total_egos'])assert.equal(result[key],'0');
  assert.equal(new Date(result.month_start).toISOString(),'2026-11-01T04:00:00.000Z');
  assert.equal(new Date(result.month_end).toISOString(),'2026-12-01T05:00:00.000Z');
});
test('signups include accounts without profiles, respect local month boundaries and exclude future timestamps',async()=>{
  await db.exec(`insert into auth.users(created_at) values
    ('2026-09-15T12:00:00Z'),('2026-10-01T03:59:59Z'),('2026-10-01T04:00:00Z'),
    ('2026-11-01T03:59:58Z'),('2026-11-01T04:00:00Z'),('2026-11-25T12:00:00Z');`);
  const october=await overview('2026-11-01T03:59:59Z');
  assert.equal(october.total_users,'6');assert.equal(october.new_users_this_month,'2');
  assert.equal((await overview('2026-11-01T04:00:00Z')).new_users_this_month,'1');
});
test('memes include private saved generations; egos count only published uploads',async()=>{
  await db.exec("insert into images(source,published_at) values('generated',null),('generated',now()),('upload',null),('upload',now()),('upload',now());");
  const result=await overview('2026-10-29T12:00:00Z');
  assert.equal(result.total_memes,'2');assert.equal(result.total_egos,'2');
});
test('only the service role can invoke totals and it needs no direct access to auth users',async()=>{
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    try{await assert.rejects(db.query('select admin_overview()'),/permission denied/);}finally{await db.exec('reset role');}
  }
  await db.exec('set role service_role');
  try{
    await assert.rejects(db.query('select * from auth.users'),/permission denied/);
    assert.equal((await overview('2026-10-29T12:00:00Z')).total_users,'6');
  }finally{await db.exec('reset role');}
});
