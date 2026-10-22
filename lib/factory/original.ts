import "server-only";
import sharp from "sharp";
import { supabase } from "../supabase";
import { ImageGenerationError } from "../seedream-generation";

export const originalPath = (ownerId: string, mediaId: string) => `${ownerId}/originals/${mediaId}`;
export const batchOriginalPath = (userId: string, batchId: string) => `${userId}/factory/${batchId}/original`;
export function mediaOriginalPath(ownerId: string, mediaId: string, privatePath: string | null, publicPath: string | null) {
  const revision = /^recaption\/([0-9a-f-]+)\.webp$/i.exec(privatePath?.slice(ownerId.length + 1) ?? "")?.[1]
    ?? /^recaption-([0-9a-f-]+)\.webp$/i.exec(publicPath?.slice(ownerId.length + 1) ?? "")?.[1];
  return originalPath(ownerId, revision ?? mediaId);
}

export async function originalDataUrl(file: Blob) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const meta = await sharp(bytes, { limitInputPixels: 24_000_000 }).metadata();
  if (!["jpeg", "png"].includes(meta.format ?? "")) throw new ImageGenerationError("Upload the original JPG or PNG to change this caption.");
  return `data:image/${meta.format};base64,${bytes.toString("base64")}`;
}

export async function retainFactoryOriginal(userId: string, batchId: string, ownerId: string, mediaId: string, required = false,
  paths: { source?: string; target?: string } = {}) {
  const bucket = supabase.storage.from("generated-images");
  const target = paths.target ?? originalPath(ownerId, mediaId);
  const retained = await bucket.download(target);
  if (retained.data && !retained.error) return;
  const original = await bucket.download(paths.source ?? batchOriginalPath(userId, batchId));
  // Older batches predate original retention and can still finish publishing.
  if (original.error || !original.data) {
    if (required) throw new ImageGenerationError("Couldn’t load the original photo. Please retry.", 503);
    return;
  }
  const bytes = Buffer.from(await original.data.arrayBuffer());
  const meta = await sharp(bytes).metadata();
  const saved = await bucket.upload(target, bytes, { contentType: `image/${meta.format}`, upsert: false });
  if (saved.error) {
    const winner = await bucket.download(target);
    if (winner.error || !winner.data) throw new ImageGenerationError("Couldn’t retain the original photo. Please retry.", 503);
  }
}
