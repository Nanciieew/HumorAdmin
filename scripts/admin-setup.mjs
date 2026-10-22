// Trusted local operator tool; never imported by app routes. Never prints credentials.
// node --env-file=.env.local scripts/admin-setup.mjs migrate [--apply]
// node --env-file=.env.local scripts/admin-setup.mjs grant EMAIL [--apply]
// node --env-file=.env.local scripts/admin-setup.mjs inspect EMAIL
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function grantSql(email) {
  if (typeof email !== 'string' || email.length > 254 || !/^[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) throw new Error('Enter an exact email address.');
  const literal = `'${email.toLowerCase()}'`;
  return `begin;
    do $$
    declare target uuid;
    begin
      if (select count(*) from auth.users where lower(email) = ${literal}) <> 1 then
        raise exception 'Expected exactly one existing account for this email';
      end if;
      select u.id into target from auth.users u join public.profiles p on p.id=u.id
      where lower(u.email)=${literal} and u.email_confirmed_at is not null
        and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google');
      if target is null then raise exception 'Account requires a confirmed email, Google identity, and existing profile'; end if;
      perform 1 from public.profiles where id=target for update;
      update public.profiles set is_superadmin=true where id=target;
      if not found then raise exception 'Profile disappeared; no admin access granted'; end if;
    end;
    $$;
    select u.email,p.is_superadmin from auth.users u join public.profiles p on p.id=u.id where lower(u.email)=${literal};
    commit;`;
}

async function main() {
  const [command, emailOrApply, ...rest] = process.argv.slice(2);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!url || !token) throw new Error('Configure Supabase URL and management access token in the ignored local environment.');
  const ref = new URL(url).hostname.split('.')[0];
  async function query(sql, readOnly = true) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: readOnly }),
    });
    if (!response.ok) throw new Error(`Supabase operation failed (HTTP ${response.status}). No credentials were printed.`);
    return response.json();
  }
  if (command === 'migrate') {
    const installed = await query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_superadmin') as installed");
    if (installed[0]?.installed) {
      const functions = await query("select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_users_page','admin_media_page','admin_votes_page')");
      if (functions[0]?.count !== 3) throw new Error('Admin schema is partially installed; inspect before continuing.');
      console.log('Admin schema is already installed.'); return;
    }
    if (emailOrApply !== '--apply') { console.log('Ready to install the admin schema. Run migrate --apply to install it.'); return; }
    await query(await readFile(new URL('../supabase/migrations/20261020000001_admin_area.sql', import.meta.url), 'utf8'), false);
    console.log('Admin schema installed. All accounts default to non-admin.');
  } else if (command === 'grant' || command === 'inspect') {
    const sql = grantSql(emailOrApply);
    const target = await query(`select u.email,u.email_confirmed_at is not null as confirmed,
      exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google') as google,
      p.id is not null as has_profile,p.is_superadmin
      from auth.users u left join public.profiles p on p.id=u.id where lower(u.email)='${emailOrApply.toLowerCase()}'`);
    if (target.length !== 1 || !target[0].confirmed || !target[0].google || !target[0].has_profile) throw new Error('Expected exactly one confirmed Google account with an existing profile.');
    if (command === 'inspect') { console.log(JSON.stringify(target[0])); return; }
    if (!rest.includes('--apply')) { console.log(`Ready to grant admin access to ${target[0].email}. Run grant EMAIL --apply to save.`); return; }
    await query(sql, false);
    const verified = await query(`select u.email,p.is_superadmin from auth.users u join public.profiles p on p.id=u.id where lower(u.email)='${emailOrApply.toLowerCase()}'`);
    if (verified.length !== 1 || verified[0].is_superadmin !== true) throw new Error('Admin grant could not be verified.');
    console.log(`Verified administrator access: ${verified[0].email}`);
  } else throw new Error('Usage: migrate [--apply] | grant EMAIL [--apply] | inspect EMAIL');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error && error.message.startsWith('Supabase operation failed') ? error.message : 'Admin setup failed. Verify the command, account prerequisites, and Supabase access. No credentials were printed.'); process.exitCode = 1; });
}
