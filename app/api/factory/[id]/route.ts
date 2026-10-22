import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/profile";
import { galleryWriter } from "@/lib/gallery-http";
import { readFactoryBatch, previewFactoryBatch, publishFactoryBatch, discardFactoryBatch, cleanupFactoryBatches } from "@/lib/factory/server";
import { factoryError } from "../response";
import { requireAdmin } from "@/lib/admin/auth";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    await requireAdmin();
    const viewer = await getViewer();
    if (!viewer) return Response.json({ error: "Complete your admin profile to continue." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
    return Response.json(await previewFactoryBatch(await readFactoryBatch(viewer.user.id, (await params).id)), { headers: { "Cache-Control": "private, no-store" } });
  }
  catch (error) { return factoryError(error); }
}
export async function POST(request: Request, { params }: Context) {
  const viewer = await galleryWriter(request); if (viewer instanceof Response) return viewer;
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid selection." }, { status: 400 }); }
  if (body?.approved !== true) return Response.json({ error: "Confirm public sharing first." }, { status: 400 });
  try {
    const result = await publishFactoryBatch(viewer.user.id, (await params).id, body.selected);
    revalidatePath("/gallery"); revalidatePath("/my-works");
    after(() => cleanupFactoryBatches().catch(() => { console.error("Factory cleanup will retry on the next maintenance run."); }));
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return factoryError(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  const viewer = await galleryWriter(request); if (viewer instanceof Response) return viewer;
  try { await discardFactoryBatch(viewer.user.id, (await params).id); return Response.json({ ok: true }); }
  catch (error) { return factoryError(error); }
}
