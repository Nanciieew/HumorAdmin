"use client";

import { useId, useRef } from "react";

// Use our own English text instead of browser-localized file input chrome.
export function PhotoInput({ fileName, onSelect, disabled = false, describedBy, onFile, label = "Choose profile photo", accept = "image/jpeg,image/png,image/webp" }: {
  fileName: string; onSelect: (name: string) => void; disabled?: boolean; describedBy?: string; onFile?: (file: File | null) => void; label?: string; accept?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const statusId = useId();
  return <div className="photo-picker mt-3 flex flex-wrap items-center gap-3 text-sm">
    <input ref={input} name="photo" type="file" hidden accept={accept} disabled={disabled}
      onChange={(event) => { const file = event.target.files?.[0] ?? null; onSelect(file?.name ?? ""); onFile?.(file); }} />
    <button type="button" disabled={disabled} onClick={() => input.current?.click()}
      aria-label={label} aria-describedby={[statusId, describedBy].filter(Boolean).join(" ")}
      className="shrink-0 rounded-full border border-current/20 px-4 py-2 font-medium disabled:opacity-50">Choose file</button>
    <span id={statusId} role="status" className="min-w-0 break-all opacity-65">{fileName || "No file chosen"}</span>
  </div>;
}
