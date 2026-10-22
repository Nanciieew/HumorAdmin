import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { supabase } from "./supabase";
import { GALLERY_MIME_TYPES, MAX_GALLERY_BYTES } from "./gallery-types";

export async function normalizeGalleryImage(bytes: Buffer, mime: string, maxBytes = MAX_GALLERY_BYTES) {
  if (!bytes.length || bytes.length > maxBytes) throw new Error("Choose a photo up to 10 MB.");
  if (!GALLERY_MIME_TYPES.includes(mime)) throw new Error("Choose a JPG, PNG, or WebP photo.");
  try {
    const image = sharp(bytes, { limitInputPixels: 24_000_000 });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) > 1) throw new Error();
    const output = await image.rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    if (output.length > MAX_GALLERY_BYTES) throw new Error();
    return output;
  } catch { throw new Error("This photo couldn’t be read. Choose a still JPG, PNG, or WebP image under 24 megapixels."); }
}

// Only called with URLs returned by the trusted generation service, never with
// client input. Restrict redirects too, and bound the downloaded response.
export async function fetchGeneratedImage(source: string, signal?: AbortSignal): Promise<{ bytes: Buffer; mime: string }> {
  const allowed = ["volces.com", "volccdn.com", "byteimg.com", "volcengine.com", "ibytedtos.com"];
  let url = new URL(source);
  for (let redirect = 0; redirect < 4; redirect++) {
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        !allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
      throw new Error("The image provider returned an unsupported download address.");
    }
    const response = await fetch(url, { redirect: "manual", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000), cache: "no-store" });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.body?.cancel();
      url = new URL(response.headers.get("location")!, url); continue;
    }
    const limit = 20 * 1024 * 1024;
    if (!response.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > limit) {
      await response.body?.cancel(); throw new Error("Couldn’t save the generated image. Please try again.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Error("The generated image is too large to save."); }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), mime: response.headers.get("content-type")?.split(";")[0] ?? "" };
  }
  throw new Error("Couldn’t download the generated image.");
}

export async function saveGeneratedImage(userId: string, source: string) {
  const downloaded = await fetchGeneratedImage(source);
  const bytes = await normalizeGalleryImage(downloaded.bytes, downloaded.mime, 20 * 1024 * 1024);
  const id = randomUUID(); const path = `${userId}/${id}.webp`;
  const bucket = supabase.storage.from("generated-images");
  const uploaded = await bucket.upload(path, bytes, { contentType: "image/webp" });
  if (uploaded.error) throw new Error("Couldn’t save your generated image. Please try again.");
  const saved = await supabase.from("images").insert({ id, contributor_id: userId, source: "generated", private_storage_path: path });
  if (saved.error) { await bucket.remove([path]); throw new Error("Couldn’t save your generated image. Please try again."); }
  const signed = await bucket.createSignedUrl(path, 3600);
  if (signed.error) throw new Error("Your image was saved, but its preview couldn’t load. Open My Damage Report.");
  return { generationId: id, url: signed.data.signedUrl };
}

export async function publishGalleryImage(userId: string, assetId: string, source: "upload" | "generated") {
  const existing = await supabase.from("images").select("id,contributor_id,source,published_at,private_storage_path,created_at").eq("id", assetId).maybeSingle();
  if (existing.error) throw new Error("Couldn’t check this publication. Please try again.");
  if (existing.data && (existing.data.contributor_id !== userId || existing.data.source !== source)) {
    throw new Error("This image does not belong to you.");
  }
  if (existing.data?.published_at) return existing.data.id;
  const generated = source === "generated";
  let asset: { storage_path: string; created_at: string };
  if (generated) {
    if (!existing.data?.private_storage_path) throw new Error("This image is unavailable or does not belong to you.");
    asset = { storage_path: existing.data.private_storage_path, created_at: existing.data.created_at };
  } else {
    const ticket = await supabase.from("gallery_uploads").select("storage_path,created_at")
      .eq("id", assetId).eq("contributor_id", userId).maybeSingle();
    if (ticket.error || !ticket.data) throw new Error("This image is unavailable or does not belong to you.");
    asset = ticket.data;
  }
  if (!generated && Date.now() - Date.parse(asset.created_at) > 2 * 3600_000) throw new Error("This upload expired. Please choose your photo again.");
  const sourceBucket = supabase.storage.from(generated ? "generated-images" : "gallery-staging");
  const downloaded = await sourceBucket.download(asset.storage_path);
  if (downloaded.error) throw new Error("Upload your photo before publishing it.");
  let bytes: Buffer;
  try {
    const original = Buffer.from(await downloaded.data.arrayBuffer());
    const factoryMeme = generated && asset.storage_path.startsWith(`${userId}/factory/`);
    if (factoryMeme) {
      // Factory captions are already rendered losslessly at the upload's native
      // resolution. Publish those exact bytes; normalization would alter them.
      const meta = await sharp(original, { limitInputPixels: 24_000_000 }).metadata();
      if (!original.length || original.length > MAX_GALLERY_BYTES || meta.format !== "webp" || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height) throw new Error("This meme couldn’t be published. Please generate it again.");
      bytes = original;
    } else bytes = await normalizeGalleryImage(original, downloaded.data.type);
  }
  catch (error) {
    if (!generated) await sourceBucket.remove([asset.storage_path]);
    throw error;
  }
  // Unique per attempt: a losing concurrent publication can clean up only its
  // own object, never the object belonging to the winning database insert.
  const path = `${userId}/${randomUUID()}.webp`;
  const publicBucket = supabase.storage.from("gallery-photos");
  const uploaded = await publicBucket.upload(path, bytes, { contentType: "image/webp" });
  if (uploaded.error) throw new Error("Couldn’t publish this photo. Please try again.");
  const publication = { public_storage_path: path, published_at: new Date().toISOString() };
  const saved = generated
    ? await supabase.from("images").update(publication).eq("id", assetId).eq("contributor_id", userId)
      .eq("source", "generated").is("published_at", null).select("id").maybeSingle()
    : await supabase.from("images").insert({ id: assetId, contributor_id: userId, source,
      created_at: asset.created_at, ...publication }).select("id").single();
  if (saved.error || !saved.data) {
    await publicBucket.remove([path]);
    const winner = await supabase.from("images").select("id").eq("id", assetId).eq("contributor_id", userId)
      .eq("source", source).not("published_at", "is", null).maybeSingle();
    if (winner.error || !winner.data) throw new Error("Couldn’t publish this photo. Please try again.");
  }
  if (!generated) {
    await sourceBucket.remove([asset.storage_path]);
    // Retain the ticket until cleanup so a still-valid upload token cannot
    // leave an untracked object if it is reused after publication.
  }
  return assetId;
}

let lastCleanup = 0;
export async function cleanupGalleryStaging() {
  if (Date.now() - lastCleanup < 5 * 60_000) return;
  lastCleanup = Date.now();
  const { data, error } = await supabase.from("gallery_uploads").select("id,storage_path")
    .lt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString()).order("created_at").limit(100);
  if (error) { lastCleanup = 0; console.error("Gallery staging cleanup could not list expired tickets."); return; }
  if (!data.length) return;
  const removed = await supabase.storage.from("gallery-staging").remove(data.map((row) => row.storage_path));
  if (removed.error) { lastCleanup = 0; console.error("Gallery staging cleanup could not remove expired objects."); return; }
  const deleted = await supabase.from("gallery_uploads").delete().in("id", data.map((row) => row.id));
  if (deleted.error) { lastCleanup = 0; console.error("Gallery staging cleanup could not remove expired tickets."); }
}
