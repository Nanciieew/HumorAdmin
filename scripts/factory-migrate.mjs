// node --env-file=.env.local scripts/factory-migrate.mjs [--apply]
// Reads existing credentials without printing them.
import {readFile} from 'node:fs/promises';
try {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,token=process.env.SUPABASE_ACCESS_TOKEN;
 if(!url||!token)throw new Error('Supabase project URL and management access token must be configured.');
 const ref=new URL(url).hostname.split('.')[0];
 async function query(sql,readOnly=true){
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:readOnly})});
  if(!response.ok)throw new Error(`Supabase management request failed (HTTP ${response.status}). No credentials were printed.`);
  return response.json();
 }
 const rows=await query("select to_regclass('public.images') as images, to_regclass('public.factory_batches') as batches");
 if(!rows[0]?.images)throw new Error('Apply the image/gallery schema first.');
 const buckets=await query("select allowed_mime_types from storage.buckets where id = 'generated-images'");
 if(!buckets.length)throw new Error('The private generated-images bucket must be installed first.');
 const mime=buckets[0].allowed_mime_types;
 const originalsReady=mime===null||['image/jpeg','image/png'].every(type=>mime.includes(type));
 const columns=await query("select table_name from information_schema.columns where table_schema='public' and table_name in ('images','factory_batches') and column_name='original_storage_path'");
 const linksReady=columns.length===2;
 if(rows[0].batches&&originalsReady&&linksReady){console.log('Factory schema, original-photo links and storage are already configured.');process.exit(0);}
 if(!process.argv.includes('--apply')){console.log('Ready to configure Factory batches and original JPG/PNG retention. Run with --apply to install the missing configuration.');process.exit(0);}
 if(!rows[0].batches){
  const sql=await readFile(new URL('../supabase/migrations/20261019000000_factory_batches.sql',import.meta.url),'utf8');
  await query(sql,false);
 }
 if(!originalsReady){
  const sql=await readFile(new URL('../supabase/migrations/20261022000000_retain_factory_originals.sql',import.meta.url),'utf8');
  await query(sql,false);
 }
 if(!linksReady){
  const sql=await readFile(new URL('../supabase/migrations/20261022000001_link_factory_originals.sql',import.meta.url),'utf8');
  await query(sql,false);
 }
 console.log('Factory configuration installed. Existing images, owners and votes were preserved.');
}catch(error){console.error(error instanceof Error?error.message:'Factory migration failed.');process.exitCode=1;}
