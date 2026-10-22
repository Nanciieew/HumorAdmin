import "server-only";
import { revalidatePath } from "next/cache";
import { AdminError, requireAdmin } from "./auth";
import { readBoundedJson } from "@/lib/roast/read-body";

export const adminHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export function adminJson(data: unknown, status = 200) { return Response.json(data, { status, headers: adminHeaders }); }

export async function adminEndpoint(request: Request, run: () => Promise<Response>) {
  try {
    await requireAdmin();
    if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== new URL(request.url).origin) {
      throw new AdminError("Invalid request origin.", 403);
    }
    return await run();
  } catch (error) {
    if (error instanceof AdminError) return adminJson({ error: error.message }, error.status);
    console.error("Admin operation failed.", error instanceof Error ? error.name : "Unknown error");
    return adminJson({ error: "The admin operation failed. Please try again." }, 503);
  }
}

export async function adminBody(request: Request) {
  try { return await readBoundedJson(request, 32_768); }
  catch { throw new AdminError("Enter a valid request under 32 KB."); }
}

export async function adminUploadBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AdminError("Choose an image to upload.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024 + 65_536) { await reader.cancel(); throw new AdminError("Choose an image up to 2 MB.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
  } catch { throw new AdminError("Choose a valid image upload."); }
}

export function refreshAdminMedia(id?: string) {
  for (const path of ["/admin", "/admin/media", "/gallery", "/my-works", "/leaderboard", "/"]) revalidatePath(path);
  if (id) revalidatePath(`/my-works/${id}`);
}
