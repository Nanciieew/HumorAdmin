import "server-only";
import { cache } from "react";
import { createAuthClient } from "@/lib/auth/server";
import { supabase } from "@/lib/supabase";
import { AdminError, verifiedAdminUser } from "@/lib/admin/auth";

export type Profile = { id: string; first_name: string | null; last_name: string | null; avatar_path: string | null; state_code: string | null; onboarding_completed_at: string | null; is_superadmin: boolean };

export async function readProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles")
    .select("id, first_name, last_name, avatar_path, state_code, onboarding_completed_at, is_superadmin").eq("id", userId).maybeSingle();
  if (error) throw new Error("Unable to load your profile. Please try again.");
  return data;
}

// Reuse user verification across layouts, pages and data helpers in one request.
export const getAuthUser = cache(async () => {
  const auth = await createAuthClient();
  try { return await verifiedAdminUser(auth); }
  catch (error) {
    if (error instanceof AdminError && [401, 403].includes(error.status)) return null;
    throw error;
  }
});

// A verified OAuth session may still be waiting for signup to finish.
export const getAuthViewer = cache(async () => {
  const user = await getAuthUser();
  if (!user) return null;
  return { user, profile: await readProfile(user.id) };
});

export const getViewer = cache(async () => {
  const viewer = await getAuthViewer();
  return viewer?.profile?.onboarding_completed_at ? viewer : null;
});
