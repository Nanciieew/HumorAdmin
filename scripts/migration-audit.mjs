// Read-only shared-project audit. Never prints credentials or user records.
import { readFile, writeFile } from 'node:fs/promises';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!url || !token) throw new Error('Configure Supabase URL and local management token.');
const ref = new URL(url).hostname.split('.')[0];
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Read-only audit failed: HTTP ${response.status}`);
  return response.json();
}
const sql = {
  tables: `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('profiles','images','photo_votes','ego_votes','image_sales','gallery_uploads','factory_batches')`,
  columns: `select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns
    where table_schema='public' and table_name in ('profiles','images','factory_batches') order by table_name,ordinal_position`,
  functions: `select p.proname,p.oid::regprocedure::text as signature,p.prosecdef,p.proconfig,p.prosrc,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('admin_users_page','admin_media_page','admin_votes_page','ego_maintenance')`,
  buckets: `select id,public,file_size_limit,allowed_mime_types from storage.buckets
    where id in ('generated-images','gallery-photos','gallery-staging','profile-photos','challenge-entries') order by id`,
  indexes: `select indexname,indexdef from pg_indexes where schemaname='public' and tablename='factory_batches'`,
  constraints: `select r.relname as table_name,c.conname,c.contype,c.confdeltype,pg_get_constraintdef(c.oid) as definition
    from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace
    where n.nspname='public' and r.relname in ('images','photo_votes','image_sales','factory_batches')`,
  policies: `select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
    where (schemaname='public' and tablename in ('profiles','images','photo_votes','factory_batches')) or schemaname='storage'`,
  privileges: `select role,
    has_table_privilege(role,'public.profiles','INSERT,UPDATE,DELETE') as profile_write,
    has_column_privilege(role,'public.profiles','is_superadmin','INSERT,UPDATE') as admin_flag_write,
    has_table_privilege(role,'public.factory_batches','SELECT,INSERT,UPDATE,DELETE') as factory_access
    from (values ('anon'),('authenticated'),('service_role')) as roles(role)`,
};
const report = { checkedAt: new Date().toISOString(), projectRef: ref, readOnly: true, checks: {}, schema: {} };
const results = await Promise.allSettled(Object.entries(sql).map(async ([name, value]) => [name, await query(value)]));
for (const result of results) {
  if (result.status === 'rejected') throw result.reason;
  report.schema[result.value[0]] = result.value[1];
}
const check = (name, ok) => { report.checks[name] = Boolean(ok); };
check('required_tables_and_rls', report.schema.tables.length === 7 && report.schema.tables.every(t => t.relrowsecurity));
const flag = report.schema.columns.find(c => c.table_name === 'profiles' && c.column_name === 'is_superadmin');
check('admin_flag_defaults_false', flag?.data_type === 'boolean' && flag.is_nullable === 'NO' && flag.column_default === 'false');
const migration = await readFile(new URL('../supabase/migrations/20261020000001_admin_area.sql', import.meta.url), 'utf8');
const normalize = s => s.replace(/\s+/g, ' ').trim();
for (const [name, signature] of [
  ['admin_users_page','admin_users_page(text,integer,integer,boolean)'],
  ['admin_media_page','admin_media_page(text,uuid,text,text,integer,integer)'],
  ['admin_votes_page','admin_votes_page(text,uuid,uuid,smallint,integer,integer)'],
]) {
  const matches = report.schema.functions.filter(f => f.proname === name);
  const f = matches[0];
  const expected = migration.match(new RegExp(`create function public\\.${name}[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'))?.[1];
  check(`${name}_signature_and_grants`, matches.length === 1 && f.signature.replace('public.','') === signature &&
    f.prosecdef && f.proconfig?.includes('search_path=""') && f.service_execute && !f.anon_execute && !f.authenticated_execute && !f.public_execute);
  check(`${name}_matches_snapshot`, expected && normalize(f?.prosrc ?? '') === normalize(expected));
}
for (const f of report.schema.functions) delete f.prosrc;
check('client_cannot_promote_or_access_batches', report.schema.privileges.filter(p => p.role !== 'service_role')
  .every(p => !p.profile_write && !p.admin_flag_write && !p.factory_access));
check('factory_generation_unique_index', report.schema.indexes.some(i => i.indexname === 'factory_one_generation_per_user' && /UNIQUE/.test(i.indexdef) && /generating/.test(i.indexdef)));
check('factory_expiry_index', report.schema.indexes.some(i => i.indexname === 'factory_batches_expiry'));
check('gallery_votes_cascade', report.schema.constraints.some(c => c.table_name === 'photo_votes' && /FOREIGN KEY \(photo_id\) REFERENCES images\(id\) ON DELETE CASCADE/.test(c.definition)));
check('sales_prevent_deletion', report.schema.constraints.some(c => c.table_name === 'image_sales' && /FOREIGN KEY \(image_id\) REFERENCES images\(id\)/.test(c.definition) && ['r','a'].includes(c.confdeltype)));
for (const [id, isPublic] of [['generated-images',false],['gallery-photos',true],['gallery-staging',false],['profile-photos',false],['challenge-entries',false]]) {
  const bucket = report.schema.buckets.find(b => b.id === id);
  check(`${id}_visibility`, bucket && bucket.public === isPublic);
  if (id === 'generated-images' || id === 'gallery-photos') check(`${id}_webp_limit`, bucket?.file_size_limit === 10485760 && bucket.allowed_mime_types?.length === 1 && bucket.allowed_mime_types[0] === 'image/webp');
}
const configResponse = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
});
if (configResponse.ok) {
  const config = await configResponse.json();
  report.auth = { siteUrl: config.site_url, redirectAllowList: config.uri_allow_list, googleEnabled: config.external_google_enabled };
} else report.auth = { inspectionStatus: configResponse.status };
const destination = process.argv[2] ?? '/tmp/humoradmin-migration-audit.json';
await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ readOnly: true, checks: report.checks, auth: report.auth, report: destination }, null, 2));
if (Object.values(report.checks).some(ok => !ok)) process.exitCode = 1;
