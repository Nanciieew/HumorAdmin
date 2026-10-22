import "server-only";
import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { isUuid } from "@/lib/gallery-types";
import { fetchGeneratedImage, normalizeGalleryImage, publishGalleryImage } from "@/lib/gallery-media";
import { generateSeedreamOutput, ImageGenerationError } from "@/lib/seedream-generation";
import { AdminError, requireAdmin } from "./auth";
import type { AdminAccount, AdminMedia, AdminPage, AdminVote } from "./types";
import { mediaOriginalPath } from "../factory/original";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminError("Invalid request.");
  return value as Record<string, unknown>;
}
export function captions(value: unknown) {
  const input = object(value);
  if (typeof input.title !== "string" || typeof input.description !== "string" || input.title.trim().length > 100 || input.description.trim().length > 1000) {
    throw new AdminError("Use up to 100 characters for the title and 1,000 for the description.");
  }
  return { title: input.title.trim(), description: input.description.trim() };
}
function uuid(value: string | null) {
  if (!value) return null;
  if (!isUuid(value)) throw new AdminError("Enter a valid account or media ID.");
  return value;
}
export function pagination(params: URLSearchParams) {
  const page = params.get("page") ?? "1", limit = params.get("limit") ?? "25";
  if (!/^\d+$/.test(page) || !/^\d+$/.test(limit) || +page < 1 || +page > 10_000 || +limit < 1 || +limit > 100) throw new AdminError("Invalid page or page size.");
  return { p_offset: (+page - 1) * +limit, p_limit: +limit };
}
function search(params: URLSearchParams) {
  const text = (params.get("search") ?? "").trim();
  if (text.length > 200) throw new AdminError("Use a search of up to 200 characters.");
  return text;
}

export async function listAdminUsers(params: URLSearchParams): Promise<AdminPage<AdminAccount>> {
  await requireAdmin();
  const result = await supabase.rpc("admin_users_page", { ...pagination(params), p_search: search(params), p_completed: params.get("completed") === "true" });
  if (result.error) throw new AdminError("Unable to load accounts.", 503);
  return result.data;
}
export async function listAdminMedia(params: URLSearchParams): Promise<AdminPage<AdminMedia>> {
  await requireAdmin();
  const source = params.get("source") || null, status = params.get("status") || null;
  if (source && !["upload", "generated"].includes(source) || status && !["private", "published"].includes(status)) throw new AdminError("Invalid media filter.");
  const result = await supabase.rpc("admin_media_page", { ...pagination(params), p_search: search(params), p_owner: uuid(params.get("owner")), p_source: source, p_status: status });
  if (result.error) throw new AdminError("Unable to load media.", 503);
  return result.data;
}
export async function listAdminVotes(params: URLSearchParams): Promise<AdminPage<AdminVote>> {
  await requireAdmin();
  const kind = params.get("kind") ?? "gallery", value = params.get("value") || null;
  if (!["gallery", "battle"].includes(kind) || value && !["1", "-1"].includes(value) || kind === "battle" && value) throw new AdminError("Invalid vote filter.");
  const result = await supabase.rpc("admin_votes_page", { ...pagination(params), p_kind: kind,
    p_target: uuid(params.get("target")), p_voter: uuid(params.get("voter")), p_value: value ? +value : null });
  if (result.error) throw new AdminError("Unable to load votes.", 503);
  return result.data;
}

async function completedOwner(id: unknown, fallback: string) {
  const owner = id === undefined || id === "" ? fallback : id;
  if (!isUuid(owner)) throw new AdminError("Choose a valid owner.");
  const result = await supabase.from("profiles").select("id,onboarding_completed_at").eq("id", owner).maybeSingle();
  if (result.error) throw new AdminError("Unable to check the owner.", 503);
  if (!result.data?.onboarding_completed_at) throw new AdminError("The owner must have a completed profile.");
  return owner;
}

async function saveBytes(owner: string, bytes: Buffer, values: { title: string; description: string }) {
  await requireAdmin();
  const id = randomUUID(), path = `${owner}/${id}.webp`, bucket = supabase.storage.from("generated-images");
  const upload = await bucket.upload(path, bytes, { contentType: "image/webp", upsert: false });
  if (upload.error) throw new AdminError("Unable to save the image file.", 503);
  try {
    const saved = await supabase.from("images").insert({ id, contributor_id: owner, source: "generated", private_storage_path: path, ...values });
    if (saved.error) throw new AdminError("Unable to save the media record.", 503);
  } catch (error) {
    await removeObject("generated-images", path);
    throw error;
  }
  return { id };
}

export async function uploadAdminMedia(form: FormData) {
  const admin = await requireAdmin();
  const values = captions({ title: form.get("title"), description: form.get("description") });
  const owner = await completedOwner(form.get("owner") ?? undefined, admin.id);
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || file.size > 2 * 1024 * 1024) throw new AdminError("Choose an image up to 2 MB.");
  let bytes: Buffer;
  try { bytes = await normalizeGalleryImage(Buffer.from(await file.arrayBuffer()), file.type, 2 * 1024 * 1024); }
  catch (error) { throw new AdminError(error instanceof Error ? error.message : "Invalid image."); }
  return saveBytes(owner, bytes, values);
}

export async function generateAdminMedia(body: unknown, signal?: AbortSignal) {
  const admin = await requireAdmin(), input = object(body), values = captions(input);
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 4000) throw new AdminError("Enter a prompt between 1 and 4,000 characters.");
  const owner = await completedOwner(input.owner, admin.id);
  let downloaded;
  try {
    const url = await generateSeedreamOutput(input.prompt.trim(), undefined, signal);
    downloaded = await fetchGeneratedImage(url, signal);
  } catch (error) {
    if (error instanceof ImageGenerationError) throw new AdminError(error.message, error.status);
    if (signal?.aborted || error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new AdminError("Generation timed out. Please try again.", 504);
    throw new AdminError("Could not generate and download the image. Please try again.", 502);
  }
  const bytes = await normalizeGalleryImage(downloaded.bytes, downloaded.mime, 20 * 1024 * 1024);
  // A long-running provider call must not allow a revoked admin to save its result.
  await requireAdmin();
  await completedOwner(owner, admin.id);
  return saveBytes(owner, bytes, values);
}

async function mediaRow(id: string) {
  if (!isUuid(id)) throw new AdminError("Media not found.", 404);
  const result = await supabase.from("images").select("id,contributor_id,source,published_at,private_storage_path,public_storage_path").eq("id", id).maybeSingle();
  if (result.error) throw new AdminError("Unable to load this media.", 503);
  if (!result.data) throw new AdminError("Media not found.", 404);
  return result.data;
}

export async function previewAdminMedia(id: string) {
  await requireAdmin();
  const row = await mediaRow(id);
  const path = row.private_storage_path ?? row.public_storage_path;
  if (typeof path !== "string" || !path.startsWith(`${row.contributor_id}/`)) throw new AdminError("Preview unavailable.", 404);
  const result = await supabase.storage.from(row.private_storage_path ? "generated-images" : "gallery-photos").download(path);
  if (result.error || !result.data) throw new AdminError("Preview unavailable.", 404);
  return result.data;
}

export async function updateAdminMedia(id: string, body: unknown) {
  await requireAdmin();
  if (!isUuid(id)) throw new AdminError("Media not found.", 404);
  const values = captions(body);
  const result = await supabase.from("images").update(values).eq("id", id).select("id").maybeSingle();
  if (result.error) throw new AdminError("Unable to update the captions.", 503);
  if (!result.data) throw new AdminError("Media not found.", 404);
  return { id, ...values };
}

export async function publishAdminMedia(id: string) {
  const admin = await requireAdmin(), row = await mediaRow(id);
  await completedOwner(row.contributor_id, admin.id);
  if (!row.published_at) {
    try { await publishGalleryImage(row.contributor_id, id, row.source); }
    catch { throw new AdminError("Unable to publish this media. Please try again.", 503); }
  }
  return { id };
}

async function removeObject(bucket: string, path: string) {
  try {
    const removed = await supabase.storage.from(bucket).remove([path]);
    if (removed.error) throw new Error("Storage removal failed");
  } catch {
    // Keep exact bucket/path for an operator to retry; never log credentials or signed URLs.
    console.error("Admin media Storage cleanup requires retry", { bucket, path });
  }
}

export async function deleteAdminMedia(id: string, body: unknown) {
  await requireAdmin();
  if (object(body).confirmed !== true) throw new AdminError("Confirm permanent deletion first.");
  if (!isUuid(id)) throw new AdminError("Media not found.", 404);
  const result = await supabase.from("images").delete().eq("id", id)
    .select("contributor_id,private_storage_path,public_storage_path").maybeSingle();
  if (result.error?.code === "23503") throw new AdminError("This media is referenced by existing records, such as sales, and cannot be deleted.", 409);
  if (result.error) throw new AdminError("Unable to delete this media.", 503);
  if (result.data) {
    await removeObject("generated-images", mediaOriginalPath(result.data.contributor_id, id, result.data.private_storage_path, result.data.public_storage_path));
    for (const [bucket, path] of [["generated-images", result.data.private_storage_path], ["gallery-photos", result.data.public_storage_path]]) {
      if (typeof path === "string" && path.startsWith(`${result.data.contributor_id}/`)) await removeObject(bucket, path);
    }
  }
  return { deleted: true };
}
