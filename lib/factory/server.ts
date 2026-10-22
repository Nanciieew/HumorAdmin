import "server-only";
import { supabase } from "../supabase";
import { validateSeedreamReference } from "../seedream-reference";
import { ImageGenerationError } from "../seedream-generation";
import { publishGalleryImage } from "../gallery-media";
import { isUuid } from "../gallery-types";
import { generateMemeCaptions } from "./captions";
import { CaptionLayoutError, renderFactoryMemes } from "./render";
import type { FactoryBatch, FactoryPreview } from "./types";
import { batchOriginalPath, originalPath, retainFactoryOriginal } from "./original";
import { loadRecaptionSource, recaptionTarget, replaceMediaCaption } from "../admin/recaption";

const bucket = () => supabase.storage.from("generated-images");
export function factoryPath(userId: string, batchId: string, index: number) { return `${userId}/factory/${batchId}/${index}.webp`; }
export async function readFactoryBatch(userId: string, id: string): Promise<FactoryBatch> {
  if (!isUuid(id)) throw new ImageGenerationError("Meme batch not found.", 404);
  const found = await supabase.from("factory_batches").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (found.error) throw new ImageGenerationError("Couldn’t load this meme batch. Please try again.", 503);
  if (!found.data) throw new ImageGenerationError("Meme batch not found.", 404);
  return found.data as FactoryBatch;
}
export async function previewFactoryBatch(batch: FactoryBatch): Promise<FactoryPreview> {
  if (batch.state === "discarded" || (batch.state !== "published" && Date.parse(batch.expires_at) <= Date.now())) throw new ImageGenerationError("These previews expired. Generate a new batch.", 410);
  if (batch.state === "generating") throw new ImageGenerationError("Your five memes are still generating. Try loading them again shortly.", 409);
  const variants = await Promise.all(batch.variants.map(async (variant, index) => {
    // Unused files are deleted after publication, so only sign the retained image.
    if (batch.state === "published" && batch.selected !== index) return { caption: variant.caption, url: "" };
    const signed = await bucket().createSignedUrl(variant.path, 3600);
    if (signed.error) throw new ImageGenerationError("Couldn’t load a meme preview. Please try again.", 503);
    return { caption: variant.caption, url: signed.data.signedUrl };
  }));
  const mediaId = batch.variants[0]?.replaces?.id;
  return { id: batch.id, variants, expiresAt: batch.expires_at, selected: batch.selected, ...(mediaId ? { mediaId } : {}), ...(batch.state === "published" && batch.cleaned_at ? { photoId: mediaId ?? batch.id } : {}) };
}
export async function removeFactoryCache(batch: FactoryBatch, keep: number | null = null, keepOriginal = keep !== null && !batch.variants[keep]?.replaces) {
  const paths = Array.from({ length: 5 }, (_, index) => factoryPath(batch.user_id, batch.id, index)).filter((_, index) => index !== keep);
  const path = batch.original_storage_path ?? batchOriginalPath(batch.user_id, batch.id);
  if (!keepOriginal || !batch.original_storage_path) paths.push(path);
  const removed = await bucket().remove(paths);
  if (removed.error) throw new ImageGenerationError("Unused preview cleanup is pending. Please retry.", 503);
}
async function finishFactoryCleanup(batch: FactoryBatch, selected: number) {
  await removeFactoryCache(batch, selected);
  const saved = await supabase.from("factory_batches").update({ cleaned_at: new Date().toISOString() }).eq("id", batch.id).eq("state", "published");
  if (saved.error) throw new ImageGenerationError("Your meme is published. Retry to confirm preview cleanup.", 503);
}
export async function generateFactoryBatch(userId: string, input: unknown, signal?: AbortSignal) {
  const body = input as { id?: unknown; image?: unknown; direction?: unknown; approved?: unknown; mode?: unknown; caption?: unknown; mediaId?: unknown } | null;
  if (!isUuid(body?.id) || body?.approved !== true) throw new ImageGenerationError("Choose a photo and agree to AI generation first.");
  if (typeof body.direction !== "string" || body.direction.length > 500) throw new ImageGenerationError("Use a direction up to 500 characters.");
  const manual = body.mode === "manual";
  if (body.mode !== undefined && !["manual", "ai"].includes(body.mode as string)) throw new ImageGenerationError("Choose manual or AI captions.");
  if (manual && (typeof body.caption !== "string" || !body.caption.trim() || body.caption.trim().length > 180)) throw new ImageGenerationError("Write a caption between 1 and 180 characters.");
  if (body.mediaId !== undefined && !isUuid(body.mediaId)) throw new ImageGenerationError("Media not found.", 404);
  const replaces = body.mediaId ? await recaptionTarget(body.mediaId as string) : undefined;
  const savedSource = body.mediaId ? await loadRecaptionSource(body.mediaId as string) : null;
  const image = await validateSeedreamReference(savedSource?.image ?? body.image);
  if (!image) throw new ImageGenerationError("Choose a still JPG or PNG up to 2 MB and 24 megapixels.");
  if (!manual && (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL)) throw new ImageGenerationError("Meme generation is not configured.", 503);
  // Expire stuck jobs before the one-active-generation constraint is checked.
  const stale = await supabase.from("factory_batches").update({ state: "discarded" }).eq("user_id", userId).eq("state", "generating").lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
  if (stale.error) throw new ImageGenerationError("Couldn’t start this batch. Please try again.", 503);
  const id = body.id;
  const inserted = await supabase.from("factory_batches").insert({ id, user_id: userId, original_storage_path: batchOriginalPath(userId, id) }).select("*").single();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const prior = await supabase.from("factory_batches").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
      if (prior.data) return previewFactoryBatch(prior.data as FactoryBatch);
      throw new ImageGenerationError("Another batch is already generating. Please wait for it to finish.", 409);
    }
    throw new ImageGenerationError("Couldn’t start the factory. Please try again.", 503);
  }
  const batch = inserted.data as FactoryBatch;
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(155_000)]) : AbortSignal.timeout(155_000);
  let finalized = false;
  try {
    const original = await bucket().upload(batchOriginalPath(userId, id), Buffer.from(image.slice(image.indexOf(",") + 1), "base64"), { contentType: image.startsWith("data:image/png;") ? "image/png" : "image/jpeg" });
    if (original.error) throw new ImageGenerationError("Couldn’t save the original photo. Please try again.", 503);
    let captions: string[] = [];
    let images: Buffer[] = [];
    // Ask for shorter copy if a caption cannot fit. Never shrink the font,
    // move the caption, or alter the original to accommodate the wording.
    for (let attempt = 0; attempt < 2; attempt++) {
      captions = manual ? [(body.caption as string).trim()] : await generateMemeCaptions(image, body.direction.trim(), signal, attempt > 0);
      try { images = await renderFactoryMemes(image, captions, signal); break; }
      catch (error) {
        if (!(error instanceof CaptionLayoutError)) throw error;
        if (manual) throw new ImageGenerationError("This caption doesn’t fit the fixed meme layout. Use shorter words or a shorter caption.");
        if (attempt === 1) throw new ImageGenerationError("The captions couldn’t fit the fixed meme layout. Please try again with a shorter keyword.", 502);
      }
    }
    // Cache the five finished overlays. No image-generation provider is called.
    // Wait for every upload before cleanup, including after a sibling fails.
    const results = await Promise.allSettled(captions.map(async (caption, index) => {
      const bytes = images[index];
      if (signal?.aborted) throw new Error("Generation cancelled.");
      const path = factoryPath(userId, id, index);
      const saved = await bucket().upload(path, bytes, { contentType: "image/webp" });
      if (saved.error) throw new ImageGenerationError("Couldn’t cache a meme. Please try again.", 503);
      return { caption, path, originalSaved: true, ...(replaces ? { replaces } : {}) };
    }));
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    const variants = results.map(result => (result as PromiseFulfilledResult<{ caption: string; path: string }>).value);
    if (signal?.aborted) throw new Error("Generation cancelled.");
    const saved = await supabase.from("factory_batches").update({ variants, state: "ready" }).eq("id", id).eq("user_id", userId).eq("state", "generating").select("*").maybeSingle();
    if (saved.error || !saved.data) throw new ImageGenerationError("This generation was cancelled. Please start a new batch.", 409);
    finalized = true;
    return await previewFactoryBatch(saved.data as FactoryBatch);
  } catch (error) {
    if (finalized) throw error;
    await supabase.from("factory_batches").update({ state: "discarded" }).eq("id", id).eq("state", "generating");
    await removeFactoryCache(batch).catch(() => { /* The scheduled cleanup retries discarded caches. */ });
    throw error;
  }
}
export async function publishFactoryBatch(userId: string, id: string, selected: unknown) {
  if (!Number.isInteger(selected) || (selected as number) < 0 || (selected as number) > 4) throw new ImageGenerationError("Choose one of the five captions.");
  const index = selected as number;
  let batch = await readFactoryBatch(userId, id);
  if (batch.state === "published") {
    if (batch.selected !== index) throw new ImageGenerationError("This batch has already been published with another caption.", 409);
    await finishFactoryCleanup(batch, index);
    return { photoId: batch.variants[index].replaces?.id ?? id };
  }
  if (Date.parse(batch.expires_at) <= Date.now()) throw new ImageGenerationError("These previews expired. Generate a new batch.", 410);
  if (!["ready", "publishing"].includes(batch.state) || ![1, 5].includes(batch.variants.length) || index >= batch.variants.length) throw new ImageGenerationError("This batch is not ready to publish.", 409);
  if (batch.selected !== null && batch.selected !== index) throw new ImageGenerationError("Your caption is already confirmed. Retry publishing the confirmed version.", 409);
  if (batch.state === "publishing" && batch.lease_until && Date.parse(batch.lease_until) > Date.now()) throw new ImageGenerationError("This meme is already being published. Please try again shortly.", 409);
  const lease = new Date(Date.now() + 120_000).toISOString();
  let claim = supabase.from("factory_batches").update({ state: "publishing", selected: index, lease_until: lease }).eq("id", id).eq("user_id", userId).eq("state", batch.state).gt("expires_at", new Date().toISOString());
  if (batch.state === "publishing") claim = claim.eq("lease_until", batch.lease_until!);
  else claim = batch.selected === null ? claim.is("selected", null) : claim.eq("selected", batch.selected);
  const locked = await claim.select("*").maybeSingle();
  if (locked.error || !locked.data) throw new ImageGenerationError("Another request is publishing this meme. Please try again shortly.", 409);
  batch = locked.data as FactoryBatch;
  const photoId = batch.variants[index].replaces?.id ?? id;
  try {
    const variant = batch.variants[index];
    if (variant.replaces) {
      await replaceMediaCaption(batch, index);
    } else {
      const existing = await supabase.from("images").select("id,private_storage_path,contributor_id").eq("id", id).maybeSingle();
      if (existing.error) throw new Error("Couldn’t check the selected meme.");
      if (existing.data && (existing.data.contributor_id !== userId || existing.data.private_storage_path !== variant.path)) throw new Error("Selected meme does not match the confirmed version.");
      if (!existing.data) {
        const saved = await supabase.from("images").insert({ id, contributor_id: userId, source: "generated", private_storage_path: variant.path,
          original_storage_path: batch.original_storage_path ?? null, title: variant.caption.slice(0, 100), description: variant.caption });
        if (saved.error) throw new Error("Couldn’t save the selected meme. Please retry publishing.");
      }
      if (!batch.original_storage_path) {
        await retainFactoryOriginal(userId, id, userId, id, variant.originalSaved);
      }
      await publishGalleryImage(userId, id, "generated");
    }
    const published = await supabase.from("factory_batches").update({ state: "published", lease_until: null }).eq("id", id).eq("lease_until", lease).select("*").single();
    if (published.error) throw new Error("Your meme was published. Retry to finish preview cleanup.");
    batch = published.data as FactoryBatch;
  } catch (error) {
    await supabase.from("factory_batches").update({ state: "ready", lease_until: null }).eq("id", id).eq("state", "publishing").eq("lease_until", lease);
    throw error;
  }
  await finishFactoryCleanup(batch, index);
  return { photoId };
}
export async function discardFactoryBatch(userId: string, id: string) {
  const batch = await readFactoryBatch(userId, id);
  if (batch.state === "published") { await finishFactoryCleanup(batch, batch.selected!); return; }
  if (batch.state === "publishing") throw new ImageGenerationError("Publishing is in progress. Please wait before discarding previews.", 409);
  const changed = await supabase.from("factory_batches").update({ state: "discarded" }).eq("id", id).eq("user_id", userId).eq("state", batch.state).select("id").maybeSingle();
  if (changed.error || !changed.data) throw new ImageGenerationError("Couldn’t discard this batch. Please try again.", 409);
  await removeFactoryCache(batch);
}
export async function cleanupFactoryBatches() {
  const now = new Date().toISOString();
  const rows = await supabase.from("factory_batches").select("*").lt("expires_at", now).order("expires_at").limit(50);
  if (rows.error) throw new Error("Factory cleanup could not list expired batches.");
  for (const batch of rows.data as FactoryBatch[]) {
    if (batch.state === "publishing" && batch.lease_until && batch.lease_until > now) continue;
    let claim = supabase.from("factory_batches").update({ state: "discarded" }).eq("id", batch.id).eq("state", batch.state);
    if (batch.state === "publishing") claim = claim.eq("lease_until", batch.lease_until!);
    const locked = await claim.select("id").maybeSingle();
    if (locked.error) throw new Error("Factory cleanup could not lock an expired batch.");
    if (!locked.data) continue;
    const image = await supabase.from("images").select("id,published_at,original_storage_path").eq("id", batch.id).eq("contributor_id", batch.user_id).maybeSingle();
    if (image.error) throw new Error("Factory cleanup could not check publication.");
    // Keep the selected private original if its gallery publication succeeded,
    // even if the final batch acknowledgement was interrupted.
    await removeFactoryCache(batch, image.data?.published_at ? batch.selected : null,
      !!image.data?.published_at && !!batch.original_storage_path && image.data.original_storage_path === batch.original_storage_path);
    if (image.data && !image.data.published_at) {
      const removed = await supabase.from("images").delete().eq("id", batch.id).eq("contributor_id", batch.user_id).is("published_at", null);
      if (removed.error) throw new Error("Factory cleanup could not remove an expired draft.");
      const original = await bucket().remove([originalPath(batch.user_id, batch.id)]);
      if (original.error) throw new Error("Factory cleanup could not remove an expired original.");
    }
    const deleted = await supabase.from("factory_batches").delete().eq("id", batch.id);
    if (deleted.error) throw new Error("Factory cleanup could not remove an expired batch.");
  }
}
