import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthClient } from "@/lib/auth/server";

export class AdminError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// Deliberately not cached across operations: revocation takes effect on the next request.
// Use the user's RLS-scoped client for the permission lookup, before using any elevated client.
export async function verifyAdmin(auth: SupabaseClient) {
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user) throw new AdminError("Sign in with Google to continue.", 401);
  if (!user.email_confirmed_at || !user.identities?.some(identity => identity.provider === "google")) {
    throw new AdminError("A confirmed Google account is required.", 403);
  }
  const permission = await auth.from("profiles").select("is_superadmin").eq("id", user.id).maybeSingle();
  if (permission.error) throw new AdminError("Unable to verify admin access. Try again later.", 503);
  if (permission.data?.is_superadmin !== true) throw new AdminError("Administrator access required.", 403);
  return { id: user.id, email: user.email ?? "" };
}

export async function requireAdmin() { return verifyAdmin(await createAuthClient()); }

export async function canAccessAdmin() {
  try { await requireAdmin(); return true; } catch { return false; }
}
