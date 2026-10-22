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
 if(rows[0].batches){console.log('Factory batch schema is already installed.');process.exit(0);}
 if(!process.argv.includes('--apply')){console.log('Ready to add the private factory batch table. Run with --apply to install it.');process.exit(0);}
 const sql=await readFile(new URL('../supabase/migrations/20261019000000_factory_batches.sql',import.meta.url),'utf8');
 await query(sql,false);console.log('Factory batch schema installed. Existing images and votes were preserved.');
}catch(error){console.error(error instanceof Error?error.message:'Factory migration failed.');process.exitCode=1;}
