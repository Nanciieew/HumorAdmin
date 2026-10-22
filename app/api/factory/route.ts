import { galleryWriter } from "@/lib/gallery-http";
import { readBoundedJson } from "@/lib/roast/read-body";
import { generateFactoryBatch } from "@/lib/factory/server";
import { factoryError } from "./response";
export const maxDuration = 180;
export async function POST(request: Request) {
  const viewer = await galleryWriter(request); if (viewer instanceof Response) return viewer;
  let body;
  try { body = await readBoundedJson(request, 3_000_000); }
  catch { return Response.json({ error: "Choose a valid image up to 2 MB." }, { status: 400 }); }
  try { return Response.json(await generateFactoryBatch(viewer.user.id, body, request.signal), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return factoryError(error); }
}
