// Read-only contract check against the configured shared Supabase project.
// Never creates fixture records or calls an AI provider.
import { createClient } from '@supabase/supabase-js';
import { adminResources, resourceSelection } from '../lib/admin/resources.ts';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Configure the existing Supabase URL and server secret.');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const checks = adminResources.map(resource => ({
  page: resource.slug, source: `public.${resource.table}`,
  run: async () => {
    const result = await db.from(resource.table).select(resourceSelection(resource), { count: 'exact' }).order('created_at', { ascending: false }).order('id').range(0, 0);
    if (result.error || !Array.isArray(result.data) || result.count == null) throw new Error(`Query failed (${result.error?.code ?? 'invalid page response'}).`);
    for (const row of result.data) for (const relation of resource.relations ?? []) {
      const related = row[relation.key];
      if (related !== null && (!related || Array.isArray(related) || typeof related !== 'object' || typeof related.id !== 'string')) throw new Error(`Invalid ${relation.label.toLowerCase()} relationship.`);
    }
    return result.count;
  },
}));
for (const [page, rpc, args] of [['users','admin_users_page',{}],['images','admin_media_page',{}],['media','admin_media_page',{p_source:'generated'}]]) {
  checks.push({ page, source: rpc, run: async () => {
    const result = await db.rpc(rpc, { ...args, p_offset: 0, p_limit: 1 });
    if (result.error || !Array.isArray(result.data?.items) || !/^\d+$/.test(result.data?.total ?? '')) throw new Error(`Query failed (${result.error?.code ?? 'invalid page response'}).`);
    if (page === 'media' && result.data.items.some(row => row.source !== 'generated')) throw new Error('Generated media included another source.');
    return result.data.total;
  } });
}
const results = await Promise.allSettled(checks.map(async check => ({ page: check.page, source: check.source, count: await check.run() })));
for (const [index, result] of results.entries()) {
  if (result.status === 'fulfilled') console.log(`/admin/${result.value.page} -> ${result.value.source}: ${result.value.count} records`);
  else { console.error(`/admin/${checks[index].page}: ${result.reason instanceof Error ? result.reason.message : 'Read check failed.'}`); process.exitCode = 1; }
}
