import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
after(() => db.close());
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon,authenticated,service_role;
  create table images(id uuid primary key); create table factory_batches(id uuid primary key);`);
await db.exec(await readFile(new URL('../supabase/migrations/20261029000000_admin_catalog.sql', import.meta.url), 'utf8'));
const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
const tables = ['llm_providers','llm_models','prompt_chains','prompt_chain_steps','prompt_chain_mix','terms','ai_generation_examples','llm_responses','allowed_signup_domains','whitelisted_email_addresses'];
test('all catalog tables have RLS and deny direct anonymous and authenticated access', async () => {
  for (const table of tables) {
    assert.equal((await rows('select relrowsecurity from pg_class where relname=$1',[table]))[0].relrowsecurity,true);
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      try { await assert.rejects(rows(`select * from ${table}`), /permission denied/); await assert.rejects(rows(`delete from ${table}`), /permission denied/); }
      finally { await db.exec('reset role'); }
    }
  }
});
test('initial chain snapshot includes its real system prompt and an editable mix', async () => {
  const steps = await rows('select * from prompt_chain_steps');
  assert.equal(steps.length,1); assert.match(steps[0].system_prompt,/five DISTINCT meme captions/);
  await db.exec('set role service_role');
  try { await db.exec('update prompt_chain_mix set weight=2.5,enabled=false'); assert.equal((await rows('select enabled from prompt_chain_mix'))[0].enabled,false); }
  finally { await db.exec('reset role'); }
  await assert.rejects(db.exec('update prompt_chain_mix set weight=-1'),/check constraint/);
});
test('service role can CRUD catalogs; duplicates, invalid weights, and referenced provider deletion fail', async () => {
  await db.exec('set role service_role');
  try {
    const [provider] = await rows("insert into llm_providers(name) values('Example provider') returning id");
    const [model] = await rows("insert into llm_models(name,model_id,llm_provider_id) values('Model','model-v1',$1) returning id",[provider.id]);
    await assert.rejects(rows('delete from llm_providers where id=$1',[provider.id]),/foreign key/);
    await rows('delete from llm_models where id=$1',[model.id]); await rows('delete from llm_providers where id=$1',[provider.id]);
    for (const [table, values] of [['terms',"(term,definition) values('Wit','A definition')"], ['ai_generation_examples',"(name,prompt,output) values('Example','Prompt','Output')"], ['allowed_signup_domains',"(domain) values('columbia.edu')"], ['whitelisted_email_addresses',"(email) values('admin@columbia.edu')"]]) {
      const [row] = await rows(`insert into ${table} ${values} returning id`);
      assert.equal((await rows(`select id from ${table} where id=$1`,[row.id])).length,1);
      await rows(`delete from ${table} where id=$1`,[row.id]);
    }
    await db.exec("insert into terms(term,definition) values('Unique','Definition')");
    await assert.rejects(db.exec("insert into terms(term,definition) values('unique','Another')"),/unique constraint/);
    await assert.rejects(db.exec("insert into allowed_signup_domains(domain) values('https://bad.edu')"),/check constraint/);
    await assert.rejects(db.exec("insert into whitelisted_email_addresses(email) values('not-email')"),/check constraint/);
  } finally { await db.exec('reset role'); }
});
