import { cleanupFactoryBatches } from "@/lib/factory/server";
import { supabase } from "@/lib/supabase";
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response(null, { status: 401 });
  const r = await supabase.rpc("ego_maintenance");
  if (r.error) return Response.json({ error: "Maintenance failed." }, { status: 503 });
  const paths = r.data as string[];
  for (let i = 0; i < paths.length; i += 100) {
    const removed = await supabase.storage.from("challenge-entries").remove(paths.slice(i, i + 100));
    if (removed.error) return Response.json({ error: "Media cleanup failed." }, { status: 503 });
    const confirmed = await supabase.from("ego_media_gc").delete().in("path", paths.slice(i, i + 100));
    if (confirmed.error) return Response.json({ error: "Cleanup confirmation failed." }, { status: 503 });
  }
  try { await cleanupFactoryBatches(); }
  catch { return Response.json({ error: "Factory preview cleanup failed; it will retry." }, { status: 503 }); }
  return Response.json({ ok: true, removed: paths.length });
}
