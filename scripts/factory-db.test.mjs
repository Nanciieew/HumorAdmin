import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
test('factory migration is repeatable, private, and permits only one active generation per account',async()=>{
 const db=new PGlite();
 try {
  await db.exec('create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls;');
  const migration=await readFile(new URL('../supabase/migrations/20261019000000_factory_batches.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
  const owner='10000000-0000-4000-8000-000000000001';
  await db.query('insert into auth.users values ($1)',[owner]);
  await db.query('insert into factory_batches(id,user_id) values ($1,$2)',['20000000-0000-4000-8000-000000000001',owner]);
  await assert.rejects(db.query('insert into factory_batches(id,user_id) values ($1,$2)',['20000000-0000-4000-8000-000000000002',owner]),/factory_one_generation_per_user/);
  const rows=await db.query('select state, variants, selected, cleaned_at, expires_at > created_at as expires_later from factory_batches');
  assert.equal(rows.rows[0].state,'generating');assert.deepEqual(rows.rows[0].variants,[]);assert.equal(rows.rows[0].cleaned_at,null);assert.equal(rows.rows[0].expires_later,true);
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);await assert.rejects(db.query('select * from public.factory_batches'),/permission denied/);await db.exec('reset role');
  }
 }finally{await db.close();}
});
