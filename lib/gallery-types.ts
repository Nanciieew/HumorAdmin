export type GallerySort = "top" | "week" | "month" | "newest";
export type Vote = 1 | -1 | null;
export type GalleryPhoto = {
  kind?: "memes" | "ego";
  contributor_photo_url?: string | null;
  title?: string; description?: string;
  result?: { battle_votes: number; outcome: string; roast: string };
  id: string; photo_url: string; contributor_name: string;
  created_at: string; published_at: string; source: "upload" | "generated"; upvotes: number; vote: Vote;
};
export type GalleryPage = { items: GalleryPhoto[]; next_cursor: string | null };
export const MAX_GALLERY_BYTES = 10 * 1024 * 1024;
export const GALLERY_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
export function isGallerySort(value: unknown): value is GallerySort {
  return value === "top" || value === "week" || value === "month" || value === "newest";
}
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
