"use client";

type Draft = { image: string; name: string; expires: number };
let draft: Draft | null = null;
// Camera references cross a client navigation in memory, never in URLs or storage.
export function setDisguiseDraft(snapshot: string) {
  draft = { image: `data:image/jpeg;base64,${snapshot}`, name: "Camera snapshot", expires: Date.now() + 5 * 60000 };
}
export function peekDisguiseDraft() {
  if (draft && draft.expires <= Date.now()) draft = null;
  return draft;
}
export function clearDisguiseDraft(image: string) { if (draft?.image === image) draft = null; }
