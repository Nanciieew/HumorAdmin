import sharp from "sharp";

// Keep base64 JSON below hosting request limits and reject non-image payloads.
export async function validateSeedreamReference(value: unknown): Promise<string | null> {
  if (typeof value !== "string" || value.length > 2_800_000) return null;
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) return null;
  try {
    const image = await sharp(bytes, { limitInputPixels: 24_000_000 }).metadata();
    if (image.format !== match[1] || !image.width || !image.height || image.width < 15 || image.height < 15 || image.width > 6000 || image.height > 6000 || (image.pages ?? 1) !== 1) return null;
    return value;
  } catch { return null; }
}
