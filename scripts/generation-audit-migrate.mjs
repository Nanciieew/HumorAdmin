// Trusted maintenance tool; credentials stay in the ignored local environment.
// node --env-file=.env.local --import tsx scripts/generation-audit-migrate.mjs [--apply]
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { workflows } from '../lib/ai/workflows.ts';

const literal = value => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
export function catalogSeedSql(geminiModel, seedreamModel) {
  if (!geminiModel || !seedreamModel) throw new Error('Configure the actual Gemini and Seedream model identifiers.');
  let sql = 'begin;\n';
  for (const [name, url, model] of [
    ['Google Gemini', 'https://generativelanguage.googleapis.com/v1beta', geminiModel],
    ['ByteDance Ark', 'https://ark.cn-beijing.volces.com/api/v3', seedreamModel],
  ]) {
    sql += `insert into public.llm_providers(name,base_url) values(${literal(name)},${literal(url)}) on conflict(name) do nothing;\n`;
    sql += `insert into public.llm_models(name,model_id,llm_provider_id) select ${literal(model)},${literal(model)},id from public.llm_providers where name=${literal(name)} on conflict(llm_provider_id,model_id) do nothing;\n`;
  }
  for (const workflow of workflows) {
    sql += `insert into public.prompt_chains(name,description,workflow_key) values(${literal(workflow.name)},${literal(workflow.description)},${literal(workflow.key)}) on conflict(name) do update set workflow_key=excluded.workflow_key,description=excluded.description;\n`;
    for (const [position, step] of workflow.steps.entries()) {
      const model = step.provider === 'Google Gemini' ? geminiModel : seedreamModel;
      sql += `insert into public.prompt_chain_steps(prompt_chain_id,position,name,llm_model_id,system_prompt,user_prompt)
        select c.id,${position},${literal(step.name)},m.id,${literal(step.system_prompt)},${literal(step.user_prompt)}
        from public.prompt_chains c,public.llm_models m join public.llm_providers p on p.id=m.llm_provider_id
        where c.workflow_key=${literal(workflow.key)} and p.name=${literal(step.provider)} and m.model_id=${literal(model)}
        on conflict(prompt_chain_id,position) do update set name=excluded.name,llm_model_id=excluded.llm_model_id,system_prompt=excluded.system_prompt,user_prompt=excluded.user_prompt;\n`;
    }
    sql += `insert into public.prompt_chain_mix(prompt_chain_id) select id from public.prompt_chains where workflow_key=${literal(workflow.key)} on conflict(prompt_chain_id) do nothing;\n`;
  }
  return sql + 'commit;';
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!url || !token) throw new Error('Configure the existing Supabase URL and management token.');
  const ref = new URL(url).hostname.split('.')[0];
  async function query(sql, readOnly = true) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: readOnly }), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Supabase migration failed (HTTP ${response.status}). No credentials were printed.`);
    return response.json();
  }
  const tables = ['llm_providers','llm_models','prompt_chains','prompt_chain_steps','prompt_chain_mix','terms','ai_generation_examples','llm_responses','allowed_signup_domains','whitelisted_email_addresses'];
  const present = await query(`select table_name from information_schema.tables where table_schema='public' and table_name in (${tables.map(literal).join(',')})`);
  if (present.length && present.length !== tables.length) throw new Error('Admin catalog is partially installed; inspect before continuing.');
  const { SEEDREAM_MODEL } = await import('../lib/seedream.ts');
  const seed = catalogSeedSql(process.env.GEMINI_MODEL, SEEDREAM_MODEL);
  if (!process.argv.includes('--apply')) { console.log(`Verified ${present.length} existing catalog tables. Ready to install generation auditing and seed the deployed workflows/models.`); return; }
  if (!present.length) await query(await readFile(new URL('../supabase/migrations/20261029000000_admin_catalog.sql', import.meta.url), 'utf8'), false);
  await query(await readFile(new URL('../supabase/migrations/20261029000001_generation_audit.sql', import.meta.url), 'utf8'), false);
  await query(seed, false);
  console.log(JSON.stringify(await query(`select
    (select count(*) from public.llm_providers) as providers,
    (select count(*) from public.llm_models) as models,
    (select count(*) from public.prompt_chains where workflow_key is not null) as workflows,
    (select count(*) from public.prompt_chain_steps s join public.prompt_chains c on c.id=s.prompt_chain_id where c.workflow_key is not null) as steps,
    (select count(*) from public.generation_requests) as requests,
    (select count(*) from public.llm_responses) as responses`)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error && !error.cause ? error.message : 'Supabase connection failed. No credentials were printed.'); process.exitCode = 1; });
}
