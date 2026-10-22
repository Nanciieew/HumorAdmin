import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { parse, type Font, type Path } from "opentype.js";
import { MAX_GALLERY_BYTES } from "../gallery-types";

// A single design scale, never fitted or shrunk to suit an individual caption.
// Only the overlay scales to the original's resolution; the picture never does.
export const MEME_TYPE = Object.freeze({
  font: "Anton", referenceShortEdge: 1000, fontSize: 96,
  lineHeight: 116, strokeWidth: 12, sideInset: 48, bottomInset: 40, maxLines: 2,
});
export class CaptionLayoutError extends Error {}
let fontPromise: Promise<Font> | undefined;
function loadFont() {
  fontPromise ??= readFile(path.join(process.cwd(), "app/fonts/anton.ttf")).then(bytes => parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
  return fontPromise;
}
function wrapCaption(font: Font, caption: string, width: number) {
  const text = caption.replace(/\s+/g, " ").trim().toLocaleUpperCase("en-US");
  if (!text) throw new CaptionLayoutError("A caption cannot be empty.");
  if ([...text].some(character => !font.charToGlyphIndex(character))) throw new CaptionLayoutError("This caption contains characters outside the locked meme font.");
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (font.getAdvanceWidth(word, MEME_TYPE.fontSize) > width) throw new CaptionLayoutError("A word is too wide for the fixed caption size.");
    const next = line ? `${line} ${word}` : word;
    if (font.getAdvanceWidth(next, MEME_TYPE.fontSize) <= width) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > MEME_TYPE.maxLines) throw new CaptionLayoutError("This caption is too long for the fixed bottom caption area.");
  return lines;
}
function outlineData(outline: Path) {
  const number = (value: number) => {
    if (!Number.isFinite(value)) throw new CaptionLayoutError("The caption outline could not be rendered completely.");
    return String(Math.round(value * 1000) / 1000);
  };
  return outline.commands.map(command => {
    switch (command.type) {
      case "M": case "L": return `${command.type}${number(command.x)} ${number(command.y)}`;
      case "Q": return `Q${number(command.x1)} ${number(command.y1)} ${number(command.x)} ${number(command.y)}`;
      case "C": return `C${number(command.x1)} ${number(command.y1)} ${number(command.x2)} ${number(command.y2)} ${number(command.x)} ${number(command.y)}`;
      case "Z": return "Z";
      default: throw new CaptionLayoutError("The caption outline contains an unsupported command.");
    }
  }).join("");
}
export async function captionOverlay(caption: string, width: number, height: number) {
  const font = await loadFont();
  const scale = Math.min(width, height) / MEME_TYPE.referenceShortEdge;
  const logicalWidth = width / scale, logicalHeight = height / scale;
  const lines = wrapCaption(font, caption, logicalWidth - 2 * MEME_TYPE.sideInset);
  const lastBaseline = logicalHeight - MEME_TYPE.bottomInset - Math.abs(font.descender / font.unitsPerEm * MEME_TYPE.fontSize) - MEME_TYPE.strokeWidth / 2;
  const paths = lines.map((line, index) => {
    const bounds = font.getPath(line, 0, 0, MEME_TYPE.fontSize).getBoundingBox();
    const x = (logicalWidth - (bounds.x2 - bounds.x1)) / 2 - bounds.x1;
    const y = lastBaseline - (lines.length - 1 - index) * MEME_TYPE.lineHeight;
    // Export coordinates ourselves: OpenType's decimal rounding turns tiny
    // floating-point fractions into NaN, invalidating the rest of the line.
    const outline = outlineData(font.getPath(line, x, y, MEME_TYPE.fontSize));
    return `<path d="${outline}"/>`;
  }).join("");
  // Font outlines, rather than SVG text, eliminate installed-font substitution.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${logicalWidth} ${logicalHeight}"><g fill="#fff" stroke="#000" stroke-width="${MEME_TYPE.strokeWidth}" stroke-linejoin="round" paint-order="stroke fill">${paths}</g></svg>`;
  return { svg: Buffer.from(svg), lines, fontSize: MEME_TYPE.fontSize * scale, lastBaseline: lastBaseline * scale };
}
export async function renderFactoryMemes(image: string, captions: string[], signal?: AbortSignal) {
  const input = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
  // Decode and honour EXIF display orientation once. No resize, crop, retouch,
  // recolouring, caption removal, or generation of any image content.
  const original = await sharp(input, { limitInputPixels: 24_000_000 }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = original.info;
  const results: Buffer[] = [];
  for (const caption of captions) {
    signal?.throwIfAborted();
    const overlay = await captionOverlay(caption, width, height);
    const bytes = await sharp(original.data, { raw: { width, height, channels } }).composite([{ input: overlay.svg, blend: "over" }]).webp({ lossless: true, effort: 4 }).toBuffer();
    if (bytes.length > MAX_GALLERY_BYTES) throw new CaptionLayoutError("The finished meme is too large to save losslessly. Choose a smaller picture.");
    results.push(bytes);
  }
  return results;
}
