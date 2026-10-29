// node --env-file=.env.local scripts/admin-catalog-migrate.mjs [--apply]
// Installs only the additive admin catalog, using existing local credentials.
import { readFile } from 'node:fs/promises';
try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!url || !token) throw new Error('Configure the Supabase project URL and local management token.');
  const ref = new URL(url).hostname.split('.')[0];
  async function query(sql, readOnly = true) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: readOnly }), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Catalog migration request failed (HTTP ${response.status}).`);
    return response.json();
  }
  const tables = ['llm_providers','llm_models','prompt_chains','prompt_chain_steps','prompt_chain_mix','terms','ai_generation_examples','llm_responses','allowed_signup_domains','whitelisted_email_addresses'];
  const names = tables.map(name => `'${name}'`).join(',');
  const inspect = `select c.relname,c.relrowsecurity,
    has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
    has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as browser_access,
    has_table_privilege('service_role',c.oid,'SELECT') and has_table_privilege('service_role',c.oid,'INSERT')
      and has_table_privilege('service_role',c.oid,'UPDATE') and has_table_privilege('service_role',c.oid,'DELETE') as server_access
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${names})`;
  const existing = await query(inspect);
  if (existing.length && existing.length !== tables.length) throw new Error('A partial catalog already exists. Review it before installing this migration. No changes were made.');
  if (!existing.length) {
    const [prerequisites] = await query("select to_regclass('public.profiles') as profiles,to_regclass('public.images') as images,to_regclass('public.factory_batches') as batches");
    if (!prerequisites?.profiles || !prerequisites.images || !prerequisites.batches) throw new Error('Install the existing admin and Factory schema first.');
    if (!process.argv.includes('--apply')) { console.log('Ready to add ten admin catalog tables and a snapshot of the existing Factory prompt. Run with --apply to install.'); process.exit(0); }
    await query(await readFile(new URL('../supabase/migrations/20261029000000_admin_catalog.sql', import.meta.url), 'utf8'), false);
  }
  const verified = await query(inspect);
  if (verified.length !== tables.length || verified.some(table => !table.relrowsecurity || table.anon_access || table.browser_access || !table.server_access)) throw new Error('Catalog permissions need review. The expected server-only access checks did not pass.');
  console.log('Admin catalog installed and verified: ten tables with RLS and server-only access. Existing users, media, and login policies were preserved.');
} catch (error) { console.error(error instanceof Error ? error.message : 'Catalog migration failed.'); process.exitCode = 1; }
