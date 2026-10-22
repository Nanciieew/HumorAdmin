export type CaptionReplacement = { id: string; ownerId: string; privatePath: string | null; publicPath: string | null; originalPath?: string | null };
export type FactoryVariant = { caption: string; path: string; originalSaved?: boolean; replaces?: CaptionReplacement };
export type FactoryBatch = {
  id: string; user_id: string; state: "generating" | "ready" | "publishing" | "published" | "discarded";
  variants: FactoryVariant[]; selected: number | null; lease_until: string | null; cleaned_at: string | null; expires_at: string;
  original_storage_path?: string | null;
};
export type FactoryPreview = { id: string; variants: { caption: string; url: string }[]; expiresAt: string; photoId?: string; mediaId?: string; selected: number | null };
