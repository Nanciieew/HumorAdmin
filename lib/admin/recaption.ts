import "server-only";
import { supabase } from "../supabase";
import { isUuid } from "../gallery-types";
import { AdminError, requireAdmin } from "./auth";
import { originalDataUrl, mediaOriginalPath, retainFactoryOriginal } from "../factory/original";
import type { CaptionReplacement, FactoryBatch } from "../factory/types";

async function readMedia(id: string) {
  await requireAdmin();
  if (!isUuid(id)) throw new AdminError("Media not found.", 404);
  const result = await supabase.from("images").select("id,contributor_id,source,private_storage_path,public_storage_path,published_at,title,description").eq("id", id).maybeSingle();
  if (result.error) throw new AdminError("Couldn’t load this meme.", 503);
  if (!result.data) throw new AdminError("Media not found.", 404);
  return result.data;
}

export async function recaptionTarget(id: string): Promise<CaptionReplacement> {
  const row = await readMedia(id);
  return { id: row.id, ownerId: row.contributor_id, privatePath: row.private_storage_path, publicPath: row.public_storage_path };
}

export async function loadRecaptionSource(id: string) {
  const row = await readMedia(id);
  const original = await supabase.storage.from("generated-images").download(mediaOriginalPath(row.contributor_id, id, row.private_storage_path, row.public_storage_path));
  return { caption: row.description || row.title || "", image: original.error || !original.data ? null : await originalDataUrl(original.data) };
}

export async function replaceMediaCaption(batch: FactoryBatch, index: number) {
  const variant = batch.variants[index], target = variant.replaces!;
  const row = await readMedia(target.id);
  if (row.contributor_id !== target.ownerId) throw new AdminError("This meme’s owner changed. Reload Media and try again.", 409);
  const privatePath = row.source === "generated" ? `${target.ownerId}/recaption/${batch.id}.webp` : null;
  const publicPath = target.publicPath ? `${target.ownerId}/recaption-${batch.id}.webp` : null;
  if (row.private_storage_path === privatePath && row.public_storage_path === publicPath) {
    await retainFactoryOriginal(batch.user_id, batch.id, target.ownerId, batch.id, variant.originalSaved);
    return target.id;
  }
  if (row.private_storage_path !== target.privatePath || row.public_storage_path !== target.publicPath) throw new AdminError("This meme changed while you were editing. Reload Media and try again.", 409);
  const rendered = await supabase.storage.from("generated-images").download(variant.path);
  if (rendered.error || !rendered.data) throw new AdminError("The selected preview is unavailable. Please retry.", 503);
  const bytes = Buffer.from(await rendered.data.arrayBuffer());
  const uploads: [string, string][] = [];
  let writeAttempted = false;
  try {
    const destinations: [string, string | null][] = [["generated-images", privatePath], ["gallery-photos", publicPath]];
    for (const [bucket, path] of destinations) {
      if (!path) continue;
      const saved = await supabase.storage.from(bucket).upload(path, bytes, { contentType: "image/webp", upsert: true });
      if (saved.error) throw new AdminError("Couldn’t save the changed meme. Please retry.", 503);
      uploads.push([bucket, path]);
    }
    await retainFactoryOriginal(batch.user_id, batch.id, target.ownerId, batch.id, variant.originalSaved);
    let update = supabase.from("images").update({ title: variant.caption.slice(0, 100), description: variant.caption, private_storage_path: privatePath, public_storage_path: publicPath }).eq("id", target.id).eq("contributor_id", target.ownerId);
    update = target.privatePath === null ? update.is("private_storage_path", null) : update.eq("private_storage_path", target.privatePath);
    update = target.publicPath === null ? update.is("public_storage_path", null) : update.eq("public_storage_path", target.publicPath);
    writeAttempted = true;
    const saved = await update.select("id").maybeSingle();
    if (saved.error || !saved.data) throw new AdminError("This meme could not be updated. Reload Media and try again.", 409);
  } catch (error) {
    // A lost database acknowledgement may follow a committed update. Retain
    // these files for an idempotent retry rather than deleting referenced bytes.
    if (!writeAttempted) for (const [bucket, path] of uploads) await supabase.storage.from(bucket).remove([path]);
    throw error;
  }
  // Keep previous files intact: existing sales may refer to their exact bytes.
  return target.id;
}
