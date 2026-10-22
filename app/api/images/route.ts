import { galleryWriter } from "@/lib/gallery-http";
import { generateSeedreamImage, ImageGenerationError } from "@/lib/seedream-generation";
import { readBoundedJson } from "@/lib/roast/read-body";

export const maxDuration = 180;

export async function POST(request: Request) {
  const viewer = await galleryWriter(request); if (viewer instanceof Response) return viewer;
  let body;
  try { body = await readBoundedJson(request, 3_000_000); }
  catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  try {
    return Response.json(await generateSeedreamImage(viewer.user.id, body, request.signal), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ImageGenerationError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return Response.json({ error: timedOut ? "Generation timed out. Please try again." : "Could not connect to Ark. Please try again later." }, { status: timedOut ? 504 : 502 });
  }
}
