"use server";

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAuthClient } from "@/lib/auth/server";
import { readProfile } from "@/lib/auth/profile";
import { supabase } from "@/lib/supabase";
import { PHOTO_BUCKET, prepareProfilePhoto } from "@/lib/profile-photo";
import { isUSState } from "@/lib/us-states";
import { returnPath } from "@/lib/auth/return-path";
import { requireAdminPage } from "@/lib/admin/page";

export type ProfileState = { error?: string; success?: boolean };

export async function saveProfile(_state: ProfileState, form: FormData): Promise<ProfileState> {
  return persistProfile(form, false);
}

export async function finishOnboarding(_state: ProfileState, form: FormData): Promise<ProfileState> {
  const result = await persistProfile(form, true);
  if (result.error) return result;
  const jar = await cookies();
  const destination = returnPath(jar.get("ego_return")?.value);
  jar.delete("ego_return");
  redirect(destination);
}

async function persistProfile(form: FormData, complete: boolean): Promise<ProfileState> {
  await requireAdminPage("/profile");
  const auth = await createAuthClient();
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) redirect("/login");
  const profile = await readProfile(user.id);
  if (!complete && !profile?.onboarding_completed_at) redirect("/profile/complete");
  if (complete && profile?.onboarding_completed_at) return { success: true };

  const firstName = form.get("first_name");
  const lastName = form.get("last_name");
  const stateCode = form.get("state_code");
  if (typeof firstName !== "string" || typeof lastName !== "string" ||
      !firstName.trim() || !lastName.trim() || firstName.trim().length > 100 || lastName.trim().length > 100) {
    return { error: "Enter a first and last name, using 1–100 characters for each." };
  }
  if (!isUSState(stateCode)) return { error: "Choose a US state to represent." };
  const file = form.get("photo");
  let image: Buffer | undefined;
  if (file instanceof File && file.size > 0) {
    try {
      image = await prepareProfilePhoto(file);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Please choose another photo." };
    }
  }

  let uploadedPath: string | null = null;
  let previousPath: string | null = null;
  try {
    previousPath = profile?.avatar_path ?? null;
    if (image) {
      const path = `${user.id}/${randomUUID()}.webp`;
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, image, {
        contentType: "image/webp", upsert: false,
      });
      if (error) throw error;
      uploadedPath = path;
    }
    const values = {
      first_name: firstName.trim(), last_name: lastName.trim(),
      state_code: stateCode,
      ...(complete ? { onboarding_completed_at: new Date().toISOString() } : {}),
      ...(uploadedPath ? { avatar_path: uploadedPath } : {}),
    };
    if (!profile) {
      // The complete profile is inserted once, only after validation and upload.
      // A concurrent completion cannot overwrite the winning insert.
      const { error } = await supabase.from("profiles").insert({ id: user.id, ...values,
        avatar_url: typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null,
      });
      if (error) throw error;
    } else {
      let query = supabase.from("profiles").update(values).eq("id", user.id);
      if (complete) query = query.is("onboarding_completed_at", null);
      if (uploadedPath) {
        // A competing upload must not silently replace the photo we just read.
        query = previousPath === null ? query.is("avatar_path", null) : query.eq("avatar_path", previousPath);
      }
      const { data, error } = await query.select("id").maybeSingle();
      if (error || !data) throw error ?? new Error("Profile changed; retry.");
    }
  } catch {
    if (uploadedPath) await supabase.storage.from(PHOTO_BUCKET).remove([uploadedPath]).catch(() => {});
    return { error: "We couldn’t save your profile. Please try again." };
  }
  if (uploadedPath && previousPath?.startsWith(`${user.id}/`)) {
    // Delete only the replaced user's own object, after the database save succeeds.
    await supabase.storage.from(PHOTO_BUCKET).remove([previousPath]).catch(() => {});
  }
  revalidatePath("/", "layout");
  return { success: true };
}
